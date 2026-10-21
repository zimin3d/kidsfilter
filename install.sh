#!/bin/sh
# Установка kidsfilter (+ приложение LuCI) на роутер OpenWrt. Запуск: sh install.sh
#
# Что делает и чего не делает:
#  * при необходимости заменяет dnsmasq на dnsmasq-full (с резервной копией /etc/config/dhcp
#    и автоматическим откатом, если новый dnsmasq не запустился);
#  * копирует файлы фильтра и LuCI, добавляет задачи cron;
#  * НЕ меняет настройки firewall, сети и основного dnsmasq.

cd "$(dirname "$0")" || exit 1
SRC=$(pwd)/files
PKG_DIR=/tmp/kidsfilter-pkg
DHCP_BACKUP=/etc/kidsfilter/dhcp.backup

say() { echo "$*"; }
fail() { echo; echo "ОШИБКА: $*" >&2; exit 1; }

say "== kidsfilter: установка =="

# ---------- проверки до любых изменений ----------

[ -f /etc/openwrt_release ] || fail "это не OpenWrt"
command -v nft >/dev/null 2>&1 || fail "нужен OpenWrt 22.03 или новее (nftables/firewall4)"
[ -d "$SRC" ] || fail "не найден каталог files рядом с install.sh"
nft list tables >/dev/null 2>&1 || fail "nftables не отвечает (nft list tables)"

free_kb() { df -k "${1:-/overlay}" 2>/dev/null | awk 'NR == 2 { print $4 }'; }
f=$(free_kb /overlay); [ -n "$f" ] || f=$(free_kb /)
[ -n "$f" ] && [ "$f" -lt 300 ] && fail "мало места на флеше: свободно ${f} КБ, нужно хотя бы 300 КБ"

if command -v opkg >/dev/null 2>&1; then PM=opkg
elif command -v apk >/dev/null 2>&1; then PM=apk
else fail "не найден менеджер пакетов (opkg или apk)"
fi

has_nftset() { dnsmasq --version 2>/dev/null | grep -qE '(^| )nftset( |$)'; }

dnsmasq_ok() {
	# основной dnsmasq запущен и отвечает (localhost он берёт из /etc/hosts, интернет не нужен)
	i=0
	while [ $i -lt 10 ]; do
		pidof dnsmasq >/dev/null 2>&1 && nslookup localhost 127.0.0.1 >/dev/null 2>&1 && return 0
		i=$((i + 1)); sleep 1
	done
	return 1
}

restore_dhcp() {
	[ -f "$DHCP_BACKUP" ] && cp -p "$DHCP_BACKUP" /etc/config/dhcp
	rm -f /etc/config/dhcp-opkg /etc/config/dhcp.apk-new
}

# ---------- dnsmasq-full ----------

install_full_opkg() {
	say "Обновляю список пакетов..."
	opkg update >/tmp/kidsfilter-opkg.log 2>&1 || { cat /tmp/kidsfilter-opkg.log; fail "opkg update не удался — проверьте интернет на роутере"; }

	rm -rf "$PKG_DIR"; mkdir -p "$PKG_DIR"
	# пакеты скачиваем заранее, пока DNS работает: после удаления dnsmasq его не будет
	( cd "$PKG_DIR" && opkg download dnsmasq-full && opkg download dnsmasq ) >>/tmp/kidsfilter-opkg.log 2>&1 ||
		fail "не удалось скачать dnsmasq-full/dnsmasq"
	need=$(( $(cat "$PKG_DIR"/dnsmasq-full_*.ipk | wc -c) * 3 / 1024 + 200 ))
	f=$(free_kb /overlay)
	[ -n "$f" ] && [ "$f" -lt "$need" ] && { rm -rf "$PKG_DIR"; fail "мало места на флеше: свободно ${f} КБ, нужно около ${need} КБ"; }

	# зависимости dnsmasq-full ставим тоже заранее (они не конфликтуют с dnsmasq)
	deps=$(opkg info dnsmasq-full 2>/dev/null | sed -n 's/^Depends: //p' | head -n 1 | tr ',' '\n' |
		sed -e 's/([^)]*)//g' -e 's/^ *//' -e 's/ *$//' | grep -v -e '^libc$' -e '^$')
	if [ -n "$deps" ]; then
		say "Ставлю зависимости: $(echo $deps)"
		# shellcheck disable=SC2086
		opkg install $deps >>/tmp/kidsfilter-opkg.log 2>&1 || { tail -n 20 /tmp/kidsfilter-opkg.log; fail "не удалось установить зависимости dnsmasq-full"; }
	fi

	say "Заменяю dnsmasq на dnsmasq-full (DNS и DHCP на роутере пропадут на несколько секунд)..."
	opkg remove dnsmasq >>/tmp/kidsfilter-opkg.log 2>&1 || { tail -n 20 /tmp/kidsfilter-opkg.log; fail "не удалось удалить dnsmasq — ничего не изменено"; }
	if opkg install "$PKG_DIR"/dnsmasq-full_*.ipk >>/tmp/kidsfilter-opkg.log 2>&1; then
		restore_dhcp
		/etc/init.d/dnsmasq enable
		/etc/init.d/dnsmasq restart
		if has_nftset && dnsmasq_ok; then
			rm -rf "$PKG_DIR"
			return 0
		fi
		say "dnsmasq-full установлен, но не запустился — возвращаю обычный dnsmasq."
		opkg remove dnsmasq-full >>/tmp/kidsfilter-opkg.log 2>&1
	else
		say "dnsmasq-full не установился — возвращаю обычный dnsmasq."
	fi
	opkg install "$PKG_DIR"/dnsmasq_*.ipk >>/tmp/kidsfilter-opkg.log 2>&1
	restore_dhcp
	/etc/init.d/dnsmasq enable
	/etc/init.d/dnsmasq restart
	rm -rf "$PKG_DIR"
	tail -n 20 /tmp/kidsfilter-opkg.log
	fail "dnsmasq-full установить не удалось; прежний dnsmasq возвращён, настройки DHCP восстановлены"
}

install_full_apk() {
	C=/tmp/kidsfilter-apkcache
	LOG=/tmp/kidsfilter-apk.log
	rm -rf "$C"; mkdir -p "$C"
	say "Обновляю список пакетов..."
	apk --cache-dir "$C" update >"$LOG" 2>&1 || { cat "$LOG"; rm -rf "$C"; fail "apk update не удался — проверьте интернет на роутере"; }
	# обычный dnsmasq — в кэш заранее: откатиться можно будет без интернета
	apk --cache-dir "$C" cache download dnsmasq >>"$LOG" 2>&1 || { tail -n 20 "$LOG"; rm -rf "$C"; fail "не удалось скачать dnsmasq"; }

	say "Заменяю dnsmasq на dnsmasq-full (DNS и DHCP на роутере пропадут на несколько секунд)..."
	# --cache-predownload обязателен: без него apk сначала удаляет dnsmasq, а потом пытается
	# скачать dnsmasq-full — уже без DNS, и роутер остаётся вообще без dnsmasq
	if apk --cache-dir "$C" --cache-predownload add dnsmasq-full >>"$LOG" 2>&1 && has_nftset; then
		restore_dhcp
		/etc/init.d/dnsmasq enable
		/etc/init.d/dnsmasq restart
		if dnsmasq_ok; then
			rm -rf "$C"
			return 0
		fi
		say "dnsmasq-full установлен, но не запустился — возвращаю обычный dnsmasq."
	elif command -v dnsmasq >/dev/null 2>&1 && ! apk info -e dnsmasq-full >/dev/null 2>&1; then
		# транзакция не прошла целиком, прежний dnsmasq на месте — ничего не изменилось
		tail -n 20 "$LOG"; rm -rf "$C"
		fail "dnsmasq-full установить не удалось; ничего не изменено"
	else
		say "Установка прервалась — возвращаю обычный dnsmasq."
	fi
	apk --cache-dir "$C" --network=no add dnsmasq '!dnsmasq-full' >>"$LOG" 2>&1
	restore_dhcp
	/etc/init.d/dnsmasq enable
	/etc/init.d/dnsmasq restart
	rm -rf "$C"
	tail -n 20 "$LOG"
	dnsmasq_ok && fail "dnsmasq-full установить не удалось; прежний dnsmasq возвращён, настройки DHCP восстановлены"
	fail "dnsmasq-full установить не удалось, и обычный dnsmasq не запускается. Восстановите: apk add dnsmasq (настройки DHCP сохранены в $DHCP_BACKUP)"
}

mkdir -p /etc/kidsfilter
if ! has_nftset; then
	say "Текущий dnsmasq собран без поддержки nftset — нужен пакет dnsmasq-full."
	# резервная копия настроек DHCP/DNS: при удалении пакета dnsmasq opkg удаляет /etc/config/dhcp
	cp -p /etc/config/dhcp "$DHCP_BACKUP" || fail "не удалось сохранить /etc/config/dhcp"
	cp -p /etc/config/dhcp /tmp/dhcp.kidsfilter-backup
	say "Настройки DHCP сохранены в $DHCP_BACKUP"
	install_full_$PM
	say "dnsmasq-full установлен, настройки DHCP на месте."
fi

# ---------- файлы ----------

say "Копирую файлы..."
for f in kidsfilter.conf kids.list whitelist.txt mode; do
	[ -f "/etc/kidsfilter/$f" ] || cp "$SRC/etc/kidsfilter/$f" "/etc/kidsfilter/$f"
done
# LAN роутера в настройку (только для новой установки)
if grep -q '^LAN_IF=br-lan$' /etc/kidsfilter/kidsfilter.conf && ! ip link show dev br-lan >/dev/null 2>&1; then
	. /lib/functions/network.sh 2>/dev/null
	network_get_device lan_dev lan 2>/dev/null
	[ -n "$lan_dev" ] && sed -i "s/^LAN_IF=br-lan$/LAN_IF=$lan_dev/" /etc/kidsfilter/kidsfilter.conf &&
		say "LAN-интерфейс: $lan_dev"
fi

install_file() { # install_file <путь> <права>
	mkdir -p "$(dirname "$1")"
	cp "$SRC$1" "$1.kf-new" && chmod "$2" "$1.kf-new" && mv "$1.kf-new" "$1" || fail "не удалось записать $1"
}
install_file /usr/bin/kidsctl 755
install_file /etc/init.d/kidsfilter 755
install_file /usr/share/kidsfilter/blocked.html 644

LUCI=0
if [ -d /www/luci-static/resources ] && [ -x /sbin/rpcd ] && [ -f /usr/share/libubox/jshn.sh ]; then
	LUCI=1
	install_file /usr/libexec/rpcd/luci.kidsfilter 755
	install_file /usr/share/rpcd/acl.d/luci-app-kidsfilter.json 644
	install_file /usr/share/luci/menu.d/luci-app-kidsfilter.json 644
	install_file /www/luci-static/resources/kidsfilter/api.js 644
	for v in overview kids learn whitelist stats; do
		install_file /www/luci-static/resources/view/kidsfilter/$v.js 644
	done
	# старая отдельная веб-панель больше не нужна (и её пароль в httpd.conf)
	rm -f /www/cgi-bin/kidsfilter
	[ -f /etc/httpd.conf ] && sed -i '/^\/cgi-bin\/kidsfilter:/d' /etc/httpd.conf
else
	# без LuCI — простая страница /cgi-bin/kidsfilter с паролем root
	install_file /www/cgi-bin/kidsfilter 755
	if command -v uci >/dev/null 2>&1 && [ -f /etc/config/uhttpd ]; then
		touch /etc/httpd.conf
		grep -q '^/cgi-bin/kidsfilter:' /etc/httpd.conf || echo '/cgi-bin/kidsfilter:root:$p$root' >> /etc/httpd.conf
		if [ "$(uci -q get uhttpd.main.config)" != /etc/httpd.conf ]; then
			uci set uhttpd.main.config=/etc/httpd.conf; uci commit uhttpd
		fi
		/etc/init.d/uhttpd restart
	fi
fi

# сохранять при обновлении прошивки
for p in /etc/kidsfilter/ /usr/bin/kidsctl /etc/init.d/kidsfilter /usr/share/kidsfilter/ /usr/libexec/rpcd/luci.kidsfilter \
	/usr/share/rpcd/acl.d/luci-app-kidsfilter.json /usr/share/luci/menu.d/luci-app-kidsfilter.json \
	/www/luci-static/resources/kidsfilter/ /www/luci-static/resources/view/kidsfilter/; do
	grep -qxF "$p" /etc/sysupgrade.conf 2>/dev/null || echo "$p" >> /etc/sysupgrade.conf
done
[ $LUCI = 0 ] && { grep -qxF /www/cgi-bin/kidsfilter /etc/sysupgrade.conf || echo /www/cgi-bin/kidsfilter >> /etc/sysupgrade.conf; }

# cron: временный доступ и самоконтроль (каждую минуту), статистика (раз в 10 минут), сохранение (ночью)
touch /etc/crontabs/root
sed -i '/\/usr\/bin\/kidsctl /d' /etc/crontabs/root
cat >> /etc/crontabs/root <<'EOF'
* * * * * /usr/bin/kidsctl tick
*/10 * * * * /usr/bin/kidsctl flush try
30 3 * * * /usr/bin/kidsctl save
EOF
/etc/init.d/cron enable
/etc/init.d/cron restart

# ---------- запуск ----------

/etc/init.d/kidsfilter enable
/etc/init.d/kidsfilter stop >/dev/null 2>&1
if ! /etc/init.d/kidsfilter start; then
	say "Фильтр не запустился. Выключаю его, чтобы не мешать сети: kidsctl mode off"
	/usr/bin/kidsctl mode off >/dev/null 2>&1
	logread 2>/dev/null | grep kidsfilter | tail -n 5
	fail "см. сообщения выше и logread | grep kidsfilter"
fi
sleep 1
[ "$(/usr/bin/kidsctl effmode)" = off ] || [ -n "$(pidof dnsmasq | tr ' ' '\n' | while read -r p; do grep -l kidsfilter "/proc/$p/cmdline" 2>/dev/null; done)" ] ||
	say "Предупреждение: детский DNS пока не запущен — проверьте: kidsctl status"

if [ $LUCI = 1 ]; then
	rm -rf /tmp/luci-indexcache* /tmp/luci-modulecache 2>/dev/null
	/etc/init.d/rpcd reload
fi

echo
case $(/usr/bin/kidsctl mode | cut -d' ' -f1) in
	enforce) say "Готово. Режим: enforce (только белый список) — сохранён с прошлой установки.";;
	off) say "Готово. Режим: off (фильтр выключен) — сохранён с прошлой установки. Включить: kidsctl mode learn";;
	*) say "Готово. Режим: learn (обучение: всё открыто, запросы записываются).";;
esac
LAN_IP=$(uci -q get network.lan.ipaddr | cut -d/ -f1)
if [ $LUCI = 1 ]; then
	say "Управление: LuCI → Службы → Детский фильтр (http://${LAN_IP:-192.168.1.1}/cgi-bin/luci/admin/services/kidsfilter)"
	say "Если пункта меню не видно — обновите страницу LuCI (Ctrl+F5) или войдите заново."
else
	say "Веб-панель: http://${LAN_IP:-192.168.1.1}/cgi-bin/kidsfilter (логин root, пароль роутера)"
fi
[ -x /usr/sbin/uhttpd ] || say "Страница «Сайт закрыт» не будет показываться: нет uhttpd ($PM install uhttpd)."
say "Дальше: добавьте детские устройства (страница «Дети» или kidsctl kid add <имя> <MAC>),"
say "через 2–3 дня разберите «Обучение» и включите режим «Только белый список»."
