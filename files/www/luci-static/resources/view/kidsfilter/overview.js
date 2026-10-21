'use strict';
'require view';
'require poll';
'require ui';
'require kidsfilter.api as api';

return view.extend({
	load: function() {
		return Promise.all([ api.status(), api.dns() ]);
	},

	// после любого действия — перечитать данные и перерисовать страницу
	refresh: function() {
		return this.load().then(L.bind(function(data) {
			var node = document.getElementById('kf-overview');
			if (node)
				node.parentNode.replaceChild(this.renderBody(data), node);
		}, this)).catch(api.fail);
	},

	act: function(promise) {
		return promise.then(api.report).catch(api.fail).then(L.bind(this.refresh, this));
	},

	renderStatus: function(st) {
		var running = st.dns_pid ? 'работает' : (st.mode == 'off' ? 'не нужен (фильтр выключен)' : 'НЕ ЗАПУЩЕН');
		var mode = api.modeTitle[st.mode] || st.mode;
		if (+st.open_until > 0)
			mode += ' — временно открыт до ' + st.open_until_hm;

		var rows = [
			[ 'Режим', E('strong', mode) ],
			[ 'Детских устройств', st.kids ],
			[ 'Детский DNS', running + (st.dns_pid ? ' (pid ' + st.dns_pid + ')' : '') ],
			[ 'DNS для детей', st.dns_label ],
			[ 'Белый список', st.wl_domains + ' доменов, ' + st.wl_ips + ' IP/сетей' ]
		];
		if (st.table == '1')
			rows.push(
				[ 'Разрешённых адресов сейчас', (st.allow4 || 0) + ' IPv4, ' + (st.allow6 || 0) + ' IPv6' ],
				[ 'Перехвачено DNS-запросов', st.dns_redirected || 0 ],
				[ 'Заблокировано соединений', st.fwd_blocked || 0 ],
				[ 'Отклонено обращений к роутеру', st.router_blocked || 0 ],
				[ 'Показано страниц блокировки', st.blockpage_shown || 0 ]);
		rows.push([ 'Статистика в памяти', st.stats_kb + ' из ' + st.stats_max_kb + ' КБ' ]);

		return E('table', { 'class': 'table' }, rows.map(function(r) {
			return E('tr', { 'class': 'tr' }, [
				E('td', { 'class': 'td left', 'style': 'width:40%' }, r[0]),
				E('td', { 'class': 'td left' }, r[1])
			]);
		}));
	},

	renderMode: function(st) {
		var self = this;
		var modes = [ 'enforce', 'learn', 'off' ];
		var buttons = modes.map(function(m) {
			return api.button(api.modeTitle[m], m == st.mode ? 'cbi-button-positive' : 'cbi-button-neutral', function() {
				return self.act(api.setMode(m));
			}, m == 'off' ? 'Выключить фильтр? Дети получат обычный доступ в интернет.' : null);
		});

		var minutes = E('input', { 'type': 'number', 'min': 1, 'max': 1440, 'value': 30, 'class': 'cbi-input-text', 'style': 'width:6em' });
		var openRow = st.mode == 'enforce' ? E('div', { 'style': 'margin-top:1em' }, [
			'Открыть доступ на ', minutes, ' мин ',
			api.button('Открыть', 'cbi-button-action', function() {
				return self.act(api.open(+minutes.value));
			}),
			' ',
			+st.open_until > 0 ? api.button('Закрыть сейчас', 'cbi-button-negative', function() {
				return self.act(api.close());
			}) : '',
			E('div', { 'class': 'cbi-value-description' },
				'На это время ребёнку открыт весь интернет, а все запросы записываются. Потом на странице «Обучение» добавьте нужные сайты.')
		]) : E('div', { 'class': 'cbi-value-description', 'style': 'margin-top:1em' },
			st.mode == 'learn'
				? 'Обучение: интернет открыт, все запросы детей записываются. Через 2–3 дня разберите список на странице «Обучение» и включите «Только белый список».'
				: 'Фильтр выключен: детские устройства работают как обычные.');

		return E('div', {}, [ E('div', {}, buttons), openRow ]);
	},

	renderDns: function(st, dns) {
		var self = this;
		var cur = dns.servers || '';
		var buttons = [ api.button('DNS роутера', cur == '' ? 'cbi-button-positive' : 'cbi-button-neutral', function() {
			return self.act(api.setDns('router'));
		}) ];
		(dns.presets || []).forEach(function(p) {
			var b = api.button(p.title, cur == p.servers ? 'cbi-button-positive' : 'cbi-button-neutral', function() {
				return self.act(api.setDns(p.id));
			});
			b.title = p.servers;
			buttons.push(' ', b);
		});
		var custom = E('input', { 'type': 'text', 'class': 'cbi-input-text', 'value': cur, 'placeholder': '1.2.3.4 5.6.7.8', 'style': 'width:20em' });
		return E('div', {}, [
			E('div', {}, buttons),
			E('div', { 'style': 'margin-top:.5em' }, [
				'Свои серверы: ', custom, ' ',
				api.button('Сохранить', 'cbi-button-save', function() {
					var v = custom.value.trim();
					return self.act(api.setDns(v || 'router'));
				})
			]),
			E('div', { 'class': 'cbi-value-description' },
				'Через этот DNS разрешаются имена только для детских устройств. Семейные DNS дополнительно блокируют сайты для взрослых ' +
				'и включают безопасный поиск — особенно полезно в режиме обучения и при временном открытии.')
		]);
	},

	renderBlockpage: function(st) {
		var self = this;
		var on = st.blockpage == '1';
		var state;
		if (!on)
			state = 'Выключена: на запрещённых сайтах браузер показывает свою ошибку («Не удаётся найти сайт»).';
		else if (st.blockpage_problem)
			state = 'Включена, но не работает: ' + st.blockpage_problem + '.';
		else if (st.mode != 'enforce')
			state = 'Включена. Показывается в режиме «Только белый список».';
		else
			state = 'Включена и работает.';

		return E('div', {}, [
			E('div', {}, [
				api.button('Показывать', on ? 'cbi-button-positive' : 'cbi-button-neutral', function() {
					return self.act(api.setBlockpage(true));
				}),
				' ',
				api.button('Не показывать', on ? 'cbi-button-neutral' : 'cbi-button-positive', function() {
					return self.act(api.setBlockpage(false));
				})
			]),
			E('p', { 'style': 'margin-top:.5em' }, E('strong', state)),
			E('div', { 'class': 'cbi-value-description' },
				'Вместо ошибки браузера ребёнок видит страницу «Этот сайт закрыт» с адресом сайта. ' +
				'Она появляется, когда сайт открывают по http:// или набирают адрес вручную (браузер пробует https, ' +
				'а при отказе переходит на http). По ссылкам https:// и на сайтах, которые работают только по HTTPS ' +
				'(Google, YouTube, соцсети, банки), браузер покажет свою ошибку соединения: подменить страницу защищённого ' +
				'сайта без предупреждения о сертификате невозможно.')
		]);
	},

	renderBody: function(data) {
		var st = data[0] || {}, dns = data[1] || {};
		var self = this;
		return E('div', { 'id': 'kf-overview' }, [
			api.health(st),
			E('div', { 'class': 'cbi-section' }, [
				E('h3', 'Состояние'),
				this.renderStatus(st),
				st.mode != 'off' ? E('div', { 'style': 'margin-top:.5em' }, api.button('Перезапустить фильтр', 'cbi-button-neutral', function() {
					return self.act(api.restart());
				})) : ''
			]),
			E('div', { 'class': 'cbi-section' }, [ E('h3', 'Режим'), this.renderMode(st) ]),
			E('div', { 'class': 'cbi-section' }, [ E('h3', 'DNS для детей'), this.renderDns(st, dns) ]),
			E('div', { 'class': 'cbi-section' }, [ E('h3', 'Страница блокировки'), this.renderBlockpage(st) ])
		]);
	},

	render: function(data) {
		poll.add(L.bind(function() {
			return api.status().then(function(st) {
				var t = document.querySelector('#kf-overview table');
				// обновляем только таблицу состояния, не трогая поля ввода
				if (t && st && st.mode)
					t.parentNode.replaceChild(this.renderStatus(st), t);
			}.bind(this)).catch(function() {});
		}, this), 15);

		return E([], [
			E('h2', 'Детский фильтр'),
			E('div', { 'class': 'cbi-map-descr' },
				'Белый список сайтов для детских устройств: в режиме «Только белый список» им доступны только разрешённые сайты. ' +
				'Остальные устройства в сети не затрагиваются.'),
			this.renderBody(data)
		]);
	},

	handleSaveApply: null,
	handleSave: null,
	handleReset: null
});
