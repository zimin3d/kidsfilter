'use strict';
'require view';
'require poll';
'require ui';
'require kidsfilter.api as api';

return view.extend({
	days: 1,

	load: function() {
		return Promise.all([ api.pending(this.days), api.log(60), api.blocked(30), api.status() ]);
	},

	refresh: function() {
		return this.load().then(L.bind(function(data) {
			var node = document.getElementById('kf-learn');
			if (node)
				node.parentNode.replaceChild(this.renderBody(data), node);
		}, this)).catch(api.fail);
	},

	allow: function(items) {
		if (!items.length) {
			ui.addNotification(null, E('p', 'Ничего не отмечено.'), 'warning');
			return Promise.resolve();
		}
		return api.allow(items).then(api.report).catch(api.fail).then(L.bind(this.refresh, this));
	},

	renderPending: function(rows) {
		var self = this;
		var table = E('table', { 'class': 'table' }, [
			E('tr', { 'class': 'tr table-titles' }, [
				E('th', { 'class': 'th' }, 'Запросов'),
				E('th', { 'class': 'th' }, 'Домен'),
				E('th', { 'class': 'th' }, 'Весь сайт'),
				E('th', { 'class': 'th' }, 'Кто')
			])
		]);
		cbi_update_table(table, rows.map(function(r) {
			return [
				r.count,
				E('label', {}, [ E('input', { 'type': 'checkbox', 'class': 'kf-item', 'value': r.domain }), ' ', r.domain ]),
				r.base != r.domain
					? E('label', {}, [ E('input', { 'type': 'checkbox', 'class': 'kf-item', 'value': r.base }), ' *.' + r.base ])
					: '',
				r.kids
			];
		}), E('em', 'Нет запросов вне белого списка за выбранный период.'));

		return E('div', { 'class': 'cbi-section' }, [
			E('h3', 'Запрошено, но нет в белом списке'),
			E('div', { 'style': 'margin-bottom:.5em' }, [ 'Период: ', api.periodSelect(this.days, function(d) { self.days = d; self.refresh(); }) ]),
			table,
			rows.length ? E('div', { 'style': 'margin-top:.5em' }, [
				api.button('Разрешить отмеченные', 'cbi-button-positive', function() {
					var items = [];
					document.querySelectorAll('#kf-learn input.kf-item:checked').forEach(function(c) { items.push(c.value); });
					return self.allow(items);
				})
			]) : '',
			E('div', { 'class': 'cbi-value-description' },
				'«Весь сайт» разрешает домен со всеми поддоменами (например, *.example.com). Обычно сайту нужны несколько доменов: ' +
				'CDN, картинки, шрифты. Показано не больше 500 самых частых доменов.')
		]);
	},

	renderLogRows: function(rows) {
		var self = this;
		return rows.slice().reverse().map(function(r) {
			return [
				E('span', { 'class': 'nowrap' }, r.time),
				r.kid,
				r.listed ? r.domain : E('strong', { 'style': 'color:#c00' }, r.domain),
				r.listed ? E('span', { 'style': 'color:#1a7f37' }, 'в списке')
					: api.button('Разрешить', 'cbi-button-add', function() { return self.allow([ r.domain ]); })
			];
		});
	},

	renderLog: function(rows) {
		var table = E('table', { 'class': 'table', 'id': 'kf-log' }, [
			E('tr', { 'class': 'tr table-titles' }, [
				E('th', { 'class': 'th' }, 'Время'),
				E('th', { 'class': 'th' }, 'Кто'),
				E('th', { 'class': 'th' }, 'Домен'),
				E('th', { 'class': 'th' }, '')
			])
		]);
		cbi_update_table(table, this.renderLogRows(rows), E('em', 'Запросов пока нет.'));
		return E('div', { 'class': 'cbi-section' }, [
			E('h3', 'Запросы в реальном времени'),
			E('div', { 'class': 'cbi-value-description' },
				'Последние 60 запросов, новые сверху, обновляется каждые 10 секунд. Удобно, когда ребёнок открывает новый сайт: ' +
				'видно, какие домены ему нужны.'),
			table
		]);
	},

	renderBlocked: function(rows) {
		var self = this;
		var table = E('table', { 'class': 'table' }, [
			E('tr', { 'class': 'tr table-titles' }, [
				E('th', { 'class': 'th' }, 'Время'),
				E('th', { 'class': 'th' }, 'Кто'),
				E('th', { 'class': 'th' }, 'Адрес'),
				E('th', { 'class': 'th' }, '')
			])
		]);
		cbi_update_table(table, rows.slice().reverse().map(function(r) {
			return [
				E('span', { 'class': 'nowrap' }, r.time),
				r.kid,
				r.dst + (r.port ? ':' + r.port : '') + ' ' + r.proto,
				api.button('Разрешить IP', 'cbi-button-add', function() { return self.allow([ r.dst ]); },
					'Разрешить адрес ' + r.dst + '? Ребёнку будет доступно всё, что работает на этом адресе.')
			];
		}), E('em', 'Заблокированных соединений нет.'));
		return E('div', { 'class': 'cbi-section' }, [
			E('h3', 'Заблокированные соединения по IP'),
			E('div', { 'class': 'cbi-value-description' },
				'Программы и игры, которые подключаются к адресу напрямую, без DNS. Работает в режиме «Только белый список»; ' +
				'в журнал попадает не больше 10 записей в минуту.'),
			table
		]);
	},

	renderBody: function(data) {
		return E('div', { 'id': 'kf-learn' }, [
			api.health(data[3]),
			this.renderPending(data[0] || []),
			this.renderLog(data[1] || []),
			this.renderBlocked(data[2] || [])
		]);
	},

	render: function(data) {
		poll.add(L.bind(function() {
			return api.log(60).then(L.bind(function(rows) {
				var t = document.getElementById('kf-log');
				if (t)
					cbi_update_table(t, this.renderLogRows(rows || []), E('em', 'Запросов пока нет.'));
			}, this)).catch(function() {});
		}, this), 10);

		return E([], [
			E('h2', 'Детский фильтр — обучение'),
			E('div', { 'class': 'cbi-map-descr' },
				'Здесь собираются сайты, которые дети пытались открыть и которых нет в белом списке. ' +
				'В режиме обучения это всё, что они посещали; в режиме «Только белый список» — то, что было заблокировано.'),
			this.renderBody(data)
		]);
	},

	handleSaveApply: null,
	handleSave: null,
	handleReset: null
});
