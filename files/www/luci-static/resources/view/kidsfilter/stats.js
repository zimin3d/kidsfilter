'use strict';
'require view';
'require ui';
'require kidsfilter.api as api';

var BAR = '#4a90d9', BAR_OUT = '#e0884a';

function hbar(label, value, max, out, note) {
	var w = max ? Math.max(1, Math.round(value * 100 / max)) : 0;
	return E('div', { 'style': 'display:flex;align-items:center;gap:.5em;margin:2px 0' }, [
		E('div', { 'style': 'width:14em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap', 'title': label }, label),
		E('div', { 'style': 'flex:1;min-width:4em' },
			E('div', { 'style': 'height:.9em;border-radius:2px;width:' + w + '%;background:' + (out ? BAR_OUT : BAR) })),
		E('div', { 'style': 'width:5em;text-align:right' }, String(value)),
		E('div', { 'style': 'width:7em;font-size:85%;color:' + BAR_OUT }, note || '')
	]);
}

return view.extend({
	days: 1,

	load: function() {
		return Promise.all([ api.stats(this.days), api.status() ]);
	},

	refresh: function() {
		return this.load().then(L.bind(function(data) {
			var node = document.getElementById('kf-stats');
			if (node)
				node.parentNode.replaceChild(this.renderBody(data), node);
		}, this)).catch(api.fail);
	},

	renderKid: function(k) {
		var maxSite = 0, maxHour = 0, maxDay = 0, i;
		k.sites.forEach(function(s) { if (s.count > maxSite) maxSite = s.count; });
		for (i = 0; i < 24; i++) if ((k.hours[i] || 0) > maxHour) maxHour = k.hours[i];
		k.days.forEach(function(d) { if (d.count > maxDay) maxDay = d.count; });

		var hours = [];
		for (i = 0; i < 24; i++) {
			var v = k.hours[i] || 0, h = maxHour ? Math.round(v * 100 / maxHour) : 0;
			hours.push(E('div', { 'style': 'flex:1;display:flex;flex-direction:column;align-items:center;min-width:0',
				'title': ('0' + i).slice(-2) + ':00 — ' + v + ' запросов' }, [
				E('div', { 'style': 'height:80px;width:80%;display:flex;align-items:flex-end' },
					E('div', { 'style': 'width:100%;border-radius:2px 2px 0 0;background:' + BAR + ';height:' + (v ? Math.max(h, 2) : 0) + '%' })),
				E('div', { 'style': 'font-size:75%;color:#888' }, i % 3 == 0 ? String(i) : ' ')
			]));
		}

		var pct = k.total ? Math.round(k.outside * 100 / k.total) : 0;
		return E('div', { 'class': 'cbi-section' }, [
			E('h3', k.kid),
			E('p', [ 'Запросов: ', E('strong', String(k.total)), ', вне белого списка: ', E('strong', k.outside + ' (' + pct + '%)') ]),
			E('h4', 'Топ сайтов'),
			E('div', {}, k.sites.map(function(s) {
				return hbar(s.site, s.count, maxSite, s.out, s.out ? 'вне списка' : '');
			})),
			E('h4', { 'style': 'margin-top:1em' }, 'Активность по часам'),
			E('div', { 'style': 'display:flex;gap:2px;max-width:40em' }, hours),
			this.days > 1 ? E('h4', { 'style': 'margin-top:1em' }, 'По дням') : '',
			this.days > 1 ? E('div', {}, k.days.map(function(d) { return hbar(d.date, d.count, maxDay, false); })) : ''
		]);
	},

	renderBody: function(data) {
		var self = this, rows = data[0] || [], kids = {}, order = [];
		function kid(name) {
			if (!kids[name]) {
				kids[name] = { kid: name, total: 0, outside: 0, sites: [], hours: {}, days: [] };
				order.push(name);
			}
			return kids[name];
		}
		rows.forEach(function(r) {
			var k = kid(r.kid);
			switch (r.t) {
			case 'T': k.total = +r.a; k.outside = +r.b; break;
			case 'S': k.sites.push({ site: r.a, count: +r.b, out: +r.c }); break;
			case 'H': k.hours[+r.a] = +r.b; break;
			case 'Y': k.days.push({ date: r.a, count: +r.b }); break;
			}
		});
		order.sort();

		return E('div', { 'id': 'kf-stats' }, [
			api.health(data[1]),
			E('div', { 'style': 'margin-bottom:1em' }, [ 'Период: ', api.periodSelect(this.days, function(d) { self.days = d; self.refresh(); }) ]),
			order.length ? E([], order.map(function(n) { return self.renderKid(kids[n]); }))
				: E('div', { 'class': 'cbi-section' }, E('em', 'Нет данных за выбранный период.'))
		]);
	},

	render: function(data) {
		return E([], [
			E('h2', 'Детский фильтр — статистика'),
			E('div', { 'class': 'cbi-map-descr' },
				'Статистика по DNS-запросам детских устройств. Сайты сгруппированы по основному домену; «вне списка» — ' +
				'были запросы к доменам, которых нет в белом списке. Хранится до 30 дней.'),
			this.renderBody(data)
		]);
	},

	handleSaveApply: null,
	handleSave: null,
	handleReset: null
});
