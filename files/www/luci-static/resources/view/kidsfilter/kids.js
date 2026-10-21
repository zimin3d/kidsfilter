'use strict';
'require view';
'require ui';
'require kidsfilter.api as api';

return view.extend({
	load: function() {
		return Promise.all([ api.kids(), api.devices(), api.status() ]);
	},

	refresh: function() {
		return this.load().then(L.bind(function(data) {
			var node = document.getElementById('kf-kids');
			if (node)
				node.parentNode.replaceChild(this.renderBody(data), node);
		}, this)).catch(api.fail);
	},

	// Добавление с защитой: если устройство сейчас управляет роутером (код 3), спросить подтверждение
	addKid: function(name, mac) {
		var self = this;
		name = (name || '').trim();
		mac = (mac || '').trim();
		if (!name || !mac) {
			ui.addNotification(null, E('p', 'Укажите имя и MAC-адрес.'), 'warning');
			return Promise.resolve();
		}
		return api.kidAdd(name, mac, false).then(function(res) {
			if (res && res.code == 3) {
				if (!confirm(res.output + '\n\nВсё равно сделать устройство детским?'))
					return;
				return api.kidAdd(name, mac, true).then(api.report);
			}
			return api.report(res);
		}).catch(api.fail).then(L.bind(self.refresh, self));
	},

	renderKids: function(kids) {
		var self = this;
		var table = E('table', { 'class': 'table' }, [
			E('tr', { 'class': 'tr table-titles' }, [
				E('th', { 'class': 'th' }, 'Имя'),
				E('th', { 'class': 'th' }, 'MAC'),
				E('th', { 'class': 'th' }, 'Сейчас в сети'),
				E('th', { 'class': 'th cbi-section-actions' }, '')
			])
		]);
		cbi_update_table(table, kids.map(function(k) {
			return [
				E('strong', k.name),
				E('code', k.mac),
				k.ips ? E('span', { 'style': 'color:#1a7f37' }, k.ips) : E('em', { 'style': 'color:#888' }, 'не в сети'),
				api.button('Убрать', 'cbi-button-remove', function() {
					return api.kidDel([ k.mac ]).then(api.report).catch(api.fail).then(L.bind(self.refresh, self));
				}, 'Убрать устройство ' + k.mac + ' (' + k.name + ') из-под фильтра?')
			];
		}), E('em', 'Детских устройств пока нет — добавьте их из списка ниже или вручную.'));

		var name = E('input', { 'type': 'text', 'class': 'cbi-input-text', 'placeholder': 'Имя (без пробелов)', 'maxlength': 32 });
		var mac = E('input', { 'type': 'text', 'class': 'cbi-input-text', 'placeholder': 'aa:bb:cc:dd:ee:ff', 'style': 'width:12em' });

		return E('div', { 'class': 'cbi-section' }, [
			E('h3', 'Детские устройства'),
			table,
			E('div', { 'style': 'margin-top:1em' }, [
				'Добавить вручную: ', name, ' ', mac, ' ',
				api.button('Добавить', 'cbi-button-add', function() { return self.addKid(name.value, mac.value); })
			]),
			E('div', { 'class': 'cbi-value-description' },
				'У одного ребёнка может быть несколько устройств (кабель и Wi-Fi, ноутбук и ПК) — добавьте каждое с тем же именем. ' +
				'В Windows отключите «Случайные аппаратные адреса» для домашней сети, иначе MAC будет меняться.')
		]);
	},

	renderDevices: function(devs) {
		var self = this;
		var table = E('table', { 'class': 'table' }, [
			E('tr', { 'class': 'tr table-titles' }, [
				E('th', { 'class': 'th' }, 'Устройство'),
				E('th', { 'class': 'th' }, 'IP'),
				E('th', { 'class': 'th' }, 'MAC'),
				E('th', { 'class': 'th' }, 'Состояние'),
				E('th', { 'class': 'th' }, 'Сделать детским')
			])
		]);
		cbi_update_table(table, devs.map(function(d) {
			var action;
			if (d.kid)
				action = E('span', [ 'ребёнок: ', E('strong', d.kid) ]);
			else {
				var name = E('input', { 'type': 'text', 'class': 'cbi-input-text', 'placeholder': 'Имя', 'maxlength': 32,
					'style': 'width:9em', 'value': (d.host || '').replace(/[^A-Za-zА-Яа-яЁё0-9_.-]/g, '').substr(0, 32) });
				action = E('span', { 'class': 'nowrap' }, [ name, ' ',
					api.button('Добавить', 'cbi-button-add', function() { return self.addKid(name.value, d.mac); }) ]);
			}
			return [
				d.host ? d.host : E('em', { 'style': 'color:#888' }, '(без имени)'),
				d.ip || '',
				E('code', d.mac),
				E('span', {}, [
					d.online ? E('span', { 'style': 'color:#1a7f37' }, 'в сети') : E('span', { 'style': 'color:#888' }, 'не в сети'),
					d.admin ? E('div', { 'style': 'color:#b35c00' }, 'управляет роутером') : ''
				]),
				action
			];
		}), E('em', 'Устройства не найдены.'));

		return E('div', { 'class': 'cbi-section' }, [
			E('h3', 'Устройства в сети'),
			table,
			E('div', { 'class': 'cbi-value-description' },
				'Активные устройства — из таблицы соседей роутера (включая устройства со статическим IP), имена — из DHCP-аренд. ' +
				'«Управляет роутером» — с этого устройства сейчас открыт веб-интерфейс или SSH: если сделать его детским, доступ к роутеру с него пропадёт.')
		]);
	},

	renderBody: function(data) {
		return E('div', { 'id': 'kf-kids' }, [
			api.health(data[2]),
			this.renderKids(data[0] || []),
			this.renderDevices(data[1] || [])
		]);
	},

	render: function(data) {
		return E([], [
			E('h2', 'Детский фильтр — дети'),
			E('div', { 'class': 'cbi-map-descr' },
				'Фильтр действует на устройства по MAC-адресу. Детским устройствам закрыт доступ к самому роутеру (кроме DNS и DHCP).'),
			this.renderBody(data)
		]);
	},

	handleSaveApply: null,
	handleSave: null,
	handleReset: null
});
