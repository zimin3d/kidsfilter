#!/bin/sh
# Полное удаление kidsfilter и приложения LuCI.
# Настройки и статистика в /etc/kidsfilter остаются (удалите вручную, если не нужны);
# режим тоже сохраняется: после повторной установки фильтр вернётся в тот же режим.
# dnsmasq-full остаётся: он полностью заменяет обычный dnsmasq и ничему не мешает.

/usr/bin/kidsctl save 2>/dev/null
/etc/init.d/kidsfilter stop 2>/dev/null
/etc/init.d/kidsfilter disable 2>/dev/null
nft delete table inet kidsfilter 2>/dev/null

rm -f /usr/bin/kidsctl /etc/init.d/kidsfilter /www/cgi-bin/kidsfilter \
	/usr/libexec/rpcd/luci.kidsfilter /usr/share/rpcd/acl.d/luci-app-kidsfilter.json \
	/usr/share/luci/menu.d/luci-app-kidsfilter.json
rm -rf /www/luci-static/resources/kidsfilter /www/luci-static/resources/view/kidsfilter /var/run/kidsfilter \
	/usr/share/kidsfilter
rm -f /var/run/kidsfilter-dns.pid

sed -i '/\/usr\/bin\/kidsctl /d' /etc/crontabs/root 2>/dev/null && /etc/init.d/cron restart
[ -f /etc/httpd.conf ] && sed -i '/^\/cgi-bin\/kidsfilter:/d' /etc/httpd.conf
[ -f /etc/sysupgrade.conf ] && sed -i -e '\#kidsfilter#d' -e '\#kidsctl$#d' /etc/sysupgrade.conf

if [ -x /etc/init.d/rpcd ]; then
	rm -rf /tmp/luci-indexcache* /tmp/luci-modulecache 2>/dev/null
	/etc/init.d/rpcd reload
fi
echo "kidsfilter удалён. Настройки и статистика остались в /etc/kidsfilter."
