'use strict';
'require baseclass';
'require rpc';
'require ui';

// Общие вызовы ubus luci.kidsfilter и помощники для страниц «Детского фильтра»

function call(method, params, expect) {
	return rpc.declare({
		object: 'luci.kidsfilter',
		method: method,
		params: params || [],
		expect: expect || { '': {} }
	});
}

var rowsOf = { rows: [] };

return baseclass.extend({
	status: call('status'),
	kids: call('kids', [], rowsOf),
	devices: call('devices', [], rowsOf),
	whitelist: call('whitelist', [], rowsOf),
	pending: call('pending', ['days'], rowsOf),
	stats: call('stats', ['days'], rowsOf),
	log: call('log', ['lines'], rowsOf),
	blocked: call('blocked', ['lines'], rowsOf),
	dns: call('dns'),

	setMode: call('set_mode', ['mode']),
	open: call('open', ['minutes']),
	close: call('close'),
	allow: call('allow', ['items']),
	deny: call('deny', ['items']),
	kidAdd: call('kid_add', ['name', 'mac', 'force']),
	kidDel: call('kid_del', ['items']),
	setDns: call('set_dns', ['servers']),
	setBlockpage: call('set_blockpage', ['enabled']),
	restart: call('restart'),

	modeTitle: {
		enforce: 'Только белый список',
		learn: 'Обучение (всё открыто, запросы записываются)',
		off: 'Выключен'
	},

	// Показывает результат действия ({ok, code, output}) и возвращает его дальше
	report: function(res) {
		if (!res || typeof res != 'object')
			res = { ok: false, output: 'Нет ответа от роутера' };
		if (res.output)
			ui.addNotification(null, E('pre', { 'style': 'white-space:pre-wrap;margin:0' }, res.output),
				res.ok ? 'info' : 'warning');
		return res;
	},

	// Ошибка вызова ubus (нет прав, rpcd не отвечает и т. п.)
	fail: function(err) {
		ui.addNotification(null, E('p', 'Ошибка: ' + (err && err.message ? err.message : err)), 'danger');
	},

	// Кнопка с подтверждением и блокировкой на время запроса
	button: function(label, cls, handler, confirmText) {
		return E('button', {
			'class': 'btn cbi-button ' + (cls || 'cbi-button-action'),
			'click': ui.createHandlerFn(this, function(ev) {
				if (confirmText && !confirm(confirmText))
					return;
				return handler(ev);
			})
		}, label);
	},

	periodSelect: function(days, onchange) {
		var sel = E('select', { 'class': 'cbi-input-select', 'change': function(ev) { onchange(+ev.target.value); } }, [
			E('option', { 'value': 1 }, 'Сегодня'),
			E('option', { 'value': 3 }, '3 дня'),
			E('option', { 'value': 7 }, '7 дней'),
			E('option', { 'value': 30 }, '30 дней')
		]);
		sel.value = days;
		return sel;
	},

	// Заметное предупреждение, если фильтр не работает как ожидается
	health: function(st) {
		var w = [];
		if (!st || !st.mode)
			return E('div', { 'class': 'alert-message warning' }, 'Не удалось получить состояние фильтра.');
		if (st.mode != 'off') {
			if (st.table != '1')
				w.push('Правила фильтра не загружены. Нажмите «Перезапустить» на странице «Обзор» или посмотрите системный журнал.');
			if (!st.dns_pid)
				w.push('Детский DNS не запущен — у детских устройств сейчас нет интернета. Проверьте системный журнал (kidsfilter).');
			if (st.kids == '0')
				w.push('Не добавлено ни одного детского устройства — фильтр пока ни на кого не действует (страница «Дети»).');
		}
		return w.length ? E('div', { 'class': 'alert-message warning' }, w.map(function(t) { return E('p', t); })) : E([]);
	}
});
