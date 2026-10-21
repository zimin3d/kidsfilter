'use strict';
'require view';
'require ui';
'require kidsfilter.api as api';

return view.extend({
	load: function() {
		return Promise.all([ api.whitelist(), api.status() ]);
	},

	refresh: function() {
		return this.load().then(L.bind(function(data) {
			var node = document.getElementById('kf-wl');
			if (node)
				node.parentNode.replaceChild(this.renderBody(data), node);
		}, this)).catch(api.fail);
	},

	act: function(promise) {
		return promise.then(api.report).catch(api.fail).then(L.bind(this.refresh, this));
	},

	renderBody: function(data) {
		var self = this;
		var rows = data[0] || [];

		var input = E('textarea', { 'class': 'cbi-input-textarea', 'rows': 3, 'style': 'width:100%;max-width:40em',
			'placeholder': 'example.com\nhttps://www.example.org/page\n1.2.3.0/24' });

		var table = E('table', { 'class': 'table' }, [
			E('tr', { 'class': 'tr table-titles' }, [
				E('th', { 'class': 'th' }, 'Запись'),
				E('th', { 'class': 'th' }, 'Тип'),
				E('th', { 'class': 'th cbi-section-actions' }, '')
			])
		]);

		var filter = E('input', { 'type': 'search', 'class': 'cbi-input-text', 'placeholder': 'Поиск…', 'style': 'width:16em',
			'keyup': function(ev) {
				var q = ev.target.value.toLowerCase();
				table.querySelectorAll('tr.tr[data-entry]').forEach(function(tr) {
					tr.style.display = tr.getAttribute('data-entry').indexOf(q) >= 0 ? '' : 'none';
				});
			} });

		rows.forEach(function(r) {
			table.appendChild(E('tr', { 'class': 'tr', 'data-entry': r.entry }, [
				E('td', { 'class': 'td' }, E('label', {}, [ E('input', { 'type': 'checkbox', 'class': 'kf-item', 'value': r.entry }), ' ', r.entry ])),
				E('td', { 'class': 'td' }, r.type == 'ip' ? 'IP/сеть' : 'домен и поддомены'),
				E('td', { 'class': 'td cbi-section-actions' }, api.button('Удалить', 'cbi-button-remove', function() {
					return self.act(api.deny([ r.entry ]));
				}, 'Удалить «' + r.entry + '» из белого списка?'))
			]));
		});
		if (!rows.length)
			table.appendChild(E('tr', { 'class': 'tr placeholder' }, E('td', { 'class': 'td' }, E('em', 'Белый список пуст.'))));

		return E('div', { 'id': 'kf-wl' }, [
			api.health(data[1]),
			E('div', { 'class': 'cbi-section' }, [
				E('h3', 'Добавить'),
				input,
				E('div', { 'style': 'margin-top:.5em' }, api.button('Добавить', 'cbi-button-add', function() {
					var items = input.value.split(/[\s,]+/).filter(function(s) { return s.length; });
					if (!items.length) return;
					return self.act(api.allow(items));
				})),
				E('div', { 'class': 'cbi-value-description' },
					'По одной записи в строке: домен (разрешает и все поддомены), ссылка целиком (из неё возьмётся домен) или IP-адрес/сеть.')
			]),
			E('div', { 'class': 'cbi-section' }, [
				E('h3', 'Белый список (' + rows.length + ')'),
				E('div', { 'style': 'margin-bottom:.5em' }, [ filter, ' ',
					api.button('Удалить отмеченные', 'cbi-button-remove', function() {
						var items = [];
						table.querySelectorAll('input.kf-item:checked').forEach(function(c) { items.push(c.value); });
						if (!items.length) return;
						return self.act(api.deny(items));
					}, 'Удалить отмеченные записи из белого списка?') ]),
				table,
				E('div', { 'class': 'cbi-value-description' },
					'Удаление закрывает сайт сразу: адреса, которые DNS вернул для этого домена, убираются из разрешённых ' +
					'(кроме адресов, общих с другими разрешёнными сайтами).')
			])
		]);
	},

	render: function(data) {
		return E([], [
			E('h2', 'Детский фильтр — белый список'),
			E('div', { 'class': 'cbi-map-descr' }, 'Сайты, доступные детям в режиме «Только белый список».'),
			this.renderBody(data)
		]);
	},

	handleSaveApply: null,
	handleSave: null,
	handleReset: null
});
