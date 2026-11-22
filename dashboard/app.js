// Launch Radar — the dashboard. Reads window.RADAR (written beside dashboard/
// by main.ts) and renders the ranked board, a filterable table, a per-protocol
// detail view with the model's own arithmetic and the protocol's farm plan.
// No network: every byte it shows is in data.js.
(function () {
  'use strict';

  var D = window.RADAR;
  var app = document.getElementById('app');
  var dialog = document.getElementById('detail');
  if (!D || !app) return;

  var state = { q: '', category: 'all', tab: 'pre-token', sort: 'implied', dir: -1, selected: null };

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  var usd0 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd0.format(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }
  function fmtMult(m) {
    if (m === null || m === undefined || !isFinite(m)) return 'n/a';
    return m.toFixed(2) + 'x';
  }
  // The model recomputed in the page: TVL x category multiple x growth x tenure.
  // It must equal the implied value the board carries, or the data is stale.
  function impliedCheck(row) {
    return Math.max(1, Math.round(row.tvl_usd * row.category_multiple * row.growth_factor * row.tenure_factor));
  }

  function readHash() {
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    var params = new URLSearchParams(hash);
    if (params.get('q')) state.q = params.get('q');
    if (params.get('category')) state.category = params.get('category');
    if (params.get('tab')) state.tab = params.get('tab');
    if (params.get('p')) state.selected = params.get('p');
  }
  function writeHash() {
    var params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.category !== 'all') params.set('category', state.category);
    if (state.tab !== 'pre-token') params.set('tab', state.tab);
    if (state.selected) params.set('p', state.selected);
    var next = params.toString();
    if (next) window.history.replaceState(null, '', '#' + next);
    else window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  function visibleRows() {
    var q = state.q.trim().toLowerCase();
    return D.rows.filter(function (r) {
      if (state.category !== 'all' && (r.category || 'Other') !== state.category) return false;
      if (!q) return true;
      var hay = [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }
  function sortRows(list) {
    var key = state.sort;
    var dir = state.dir;
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === 'growth') { av = a.change_7d === null ? -Infinity : a.change_7d; bv = b.change_7d === null ? -Infinity : b.change_7d; }
      else if (key === 'age') { av = a.age_days === null ? Infinity : a.age_days; bv = b.age_days === null ? Infinity : b.age_days; }
      else if (key === 'multiple') { av = a.category_multiple; bv = b.category_multiple; }
      else { av = a.implied_value_usd; bv = b.implied_value_usd; }
      if (av < bv) return -dir;
      if (av > bv) return dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  function sortBtn(key, label) {
    var mark = state.sort === key ? (state.dir < 0 ? ' v' : ' ^') : '';
    return '<button type="button" class="sort-btn" data-sort="' + key + '">' + esc(label) + esc(mark) + '</button>';
  }

  function headerHtml() {
    return '<header class="top">' +
      '<div class="brand"><span class="mark"></span><span class="brand-name">Launch <em>Radar</em></span></div>' +
      '<div class="top-meta">' +
      '<span class="pill">Snapshot <b>' + esc(D.as_of) + '</b></span>' +
      '<span class="pill">DefiLlama protocol index</span>' +
      '<span class="pill"><b>' + esc(D.model_version) + '</b> model</span>' +
      '</div></header>';
  }

  function heroHtml() {
    return '<section class="hero">' +
      '<h1><span class="accent">' + D.watchlist_size + ' watchlist protocols</span>, ranked by what their token would be worth</h1>' +
      '<p>The watchlist is the floor: every protocol with at least $' + Math.round(D.floor_usd / 1e6) +
      'M of TVL and no token on record. The early radar adds ' + D.early_size +
      ' pre-token protocols below that floor, scored the same way. Implied value is a model built from the snapshot itself — not a promise that any token comes.</p>' +
      '<div class="stats">' +
      '<div class="stat"><span>Watchlist covered</span><b>' + D.watchlist_size + ' / ' + D.watchlist_size + '</b><small>every slug on the list</small></div>' +
      '<div class="stat"><span>Pre-token rows scored</span><b>' + D.board_size + '</b><small>ranked by implied value</small></div>' +
      '<div class="stat"><span>Early rows below the floor</span><b>' + D.early_size + '</b><small>found by the radar</small></div>' +
      '<div class="stat"><span>Live-token protocols set aside</span><b>' + D.live_size + '</b><small>shown at market cap</small></div>' +
      '</div></section>';
  }

  function controlsHtml() {
    var categories = Array.from(new Set(D.rows.map(function (r) { return r.category || 'Other'; }))).sort();
    var opts = '<option value="all">All categories</option>' + categories.map(function (c) {
      return '<option value="' + esc(c) + '"' + (c === state.category ? ' selected' : '') + '>' + esc(c) + '</option>';
    }).join('');
    return '<div class="controls">' +
      '<div class="field"><label for="q">Search</label><input type="search" id="q" placeholder="Search name, category or chain" value="' + esc(state.q) + '" aria-label="Search the board"></div>' +
      '<div class="field"><label for="category">Category</label><select id="category" aria-label="Filter by category">' + opts + '</select></div>' +
      '<div class="field"><span class="lab">Token status</span><div class="tabs">' +
      '<button type="button" data-tab="pre-token" aria-pressed="' + (state.tab === 'pre-token') + '">Pre-token</button>' +
      '<button type="button" data-tab="live" aria-pressed="' + (state.tab === 'live') + '">Live token</button>' +
      '</div></div>' +
      '<span class="count">' + (state.tab === 'pre-token' ? visibleRows().length + ' rows shown' : D.live.length + ' live-token protocols') + '</span>' +
      '</div>';
  }

  function boardTableHtml() {
    var list = sortRows(visibleRows());
    if (list.length === 0) {
      return '<div class="panel"><div class="empty"><h2>No protocol matches that filter</h2>' +
        '<p>Clear the search or pick another category to see the board again.</p>' +
        '<button class="button" type="button" data-clear="1">Clear filters</button></div></div>';
    }
    var max = 1;
    list.forEach(function (r) { if (r.implied_value_usd > max) max = r.implied_value_usd; });
    var rowsHtml = list.map(function (r) {
      var growth = r.change_7d === null ? 'n/a' : fmtPct(r.change_7d);
      var growthClass = r.change_7d === null ? '' : (r.change_7d >= 0 ? 'pos' : 'neg');
      var width = Math.max(3, Math.round((r.implied_value_usd / max) * 100));
      return '<tr data-slug="' + esc(r.slug) + '" data-selected="' + (state.selected === r.slug) + '" tabindex="0">' +
        '<td class="num">' + r.rank + '</td>' +
        '<td><div class="name"><b>' + esc(r.name) + '</b><span class="sub">' + esc(r.category || 'Other') + ' on ' +
        esc(r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') + '</span></div></td>' +
        '<td class="num">' + fmtUsd(r.tvl_usd) + '</td>' +
        '<td class="num ' + growthClass + '">' + growth + '</td>' +
        '<td class="num">' + fmtAge(r.age_days) + '</td>' +
        '<td class="num">' + fmtMult(r.category_multiple) + '</td>' +
        '<td><div class="implied"><div class="bar" aria-hidden="true"><i style="width:' + width + '%"></i></div>' +
        '<span class="num">' + fmtUsd(r.implied_value_usd) + '</span></div></td>' +
        '<td><span class="badge pre">no token</span></td></tr>';
    }).join('');
    return '<div class="panel"><div class="table-wrap"><table>' +
      '<caption>Pre-token protocols, strongest implied value first. Select a row for its model and farm plan.</caption>' +
      '<thead><tr><th scope="col">' + sortBtn('implied', 'Rank') + '</th>' +
      '<th scope="col">' + sortBtn('name', 'Protocol') + '</th>' +
      '<th scope="col" class="num">' + sortBtn('tvl', 'TVL') + '</th>' +
      '<th scope="col" class="num">' + sortBtn('growth', '7d') + '</th>' +
      '<th scope="col" class="num">' + sortBtn('age', 'Age') + '</th>' +
      '<th scope="col" class="num">' + sortBtn('multiple', 'Multiple') + '</th>' +
      '<th scope="col" style="text-align:right">' + sortBtn('implied', 'Implied value') + '</th>' +
      '<th scope="col">Token</th></tr></thead>' +
      '<tbody>' + rowsHtml + '</tbody></table></div></div>';
  }

  function liveTableHtml() {
    var rowsHtml = D.live.map(function (r) {
      return '<tr>' +
        '<td><span class="badge live">live</span></td>' +
        '<td><div class="name"><b>' + esc(r.name) + '</b><span class="sub">' + esc(r.category || 'Other') + ' on ' +
        esc(r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') + '</span></div></td>' +
        '<td class="num">' + fmtUsd(r.tvl_usd) + '</td>' +
        '<td class="num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg') + '">' + fmtPct(r.change_7d) + '</td>' +
        '<td class="num">' + fmtUsd(r.mcap_usd) + '</td>' +
        '<td><span class="badge live">already trades</span></td></tr>';
    }).join('');
    return '<div class="panel"><div class="table-wrap"><table>' +
      '<caption>Token live: these protocols already trade, so their market cap is a fact, not a model. They are set aside from the pre-token ranking.</caption>' +
      '<thead><tr><th scope="col">Status</th><th scope="col">Protocol</th><th scope="col" class="num">TVL</th>' +
      '<th scope="col" class="num">7d</th><th scope="col" class="num">Market cap</th><th scope="col">Token</th></tr></thead>' +
      '<tbody>' + rowsHtml + '</tbody></table></div></div>';
  }

  function methodHtml() {
    var m = D.model;
    return '<section class="panel method"><h2>How implied value is computed</h2>' +
      '<p>Every row is scored by one function of the snapshot figures. No protocol name is special-cased, and no row is hand-picked. The multiple is not a guess: it is the median market-cap-per-TVL of the live-token protocols in the same category, taken from this snapshot.</p>' +
      '<div class="formula">implied = round( tvl_usd x multiple x (1 + clamp(change_7d, ' + m.growth_floor + ', ' + m.growth_cap + ') / 100 x ' + m.growth_weight + ') x (' + m.tenure_floor + ' + min(age_days, ' + m.tenure_days + ') / ' + m.tenure_days + ' x ' + m.tenure_range + ') )</div>' +
      '<ul>' +
      '<li><b>Multiple:</b> the category median mcap/TVL of live-token protocols (3+ samples), else the global median of ' + D.global_multiple.toFixed(2) + 'x; clamped to ' + m.multiple_floor + '–' + m.multiple_cap + 'x.</li>' +
      '<li><b>Growth:</b> the protocol\'s own seven-day TVL change, clamped to ' + m.growth_floor + '%–' + m.growth_cap + '%, weighted ' + m.growth_weight + '.</li>' +
      '<li><b>Tenure:</b> how long the protocol has run with no token, from its first listing date; unknown age counts as ' + m.unknown_age_days + ' days.</li>' +
      '<li><b>Early radar:</b> the same exclusion rule as the watchlist — no exchange, bridge, liquid staking or restaking, versioned pool, or wrapped/staked product — applied below the floor.</li>' +
      '</ul>' +
      '<p class="note">A token may never come, a TVL can fall, and a median is not a promise. Implied value is this radar\'s claim about what a token would be worth if the protocol\'s record stayed as it is — nothing more.</p>' +
      '</section>';
  }

  function openDetail(slug) {
    var row = null;
    D.rows.forEach(function (r) { if (r.slug === slug) row = r; });
    if (!row) return;
    state.selected = slug;
    writeHash();
    var recomputed = impliedCheck(row);
    var match = recomputed === row.implied_value_usd;
    var multNote = row.multiple_source === 'category'
      ? 'Category median from ' + row.multiple_samples + ' live-token protocols in ' + (row.category || 'Other') + '.'
      : 'Global median: too few live-token protocols in this category to take a category median.';
    var stepsHtml = row.farm_steps.map(function (s) {
      var at = s.indexOf(' Cost: ');
      var action = at >= 0 ? s.slice(0, at) : s;
      var tail = at >= 0 ? s.slice(at + 1) : '';
      return '<li><b>' + esc(action) + '</b><span class="cost">' + esc(tail) + '</span></li>';
    }).join('');
    dialog.innerHTML =
      '<div class="detail-head"><div><span class="kicker">Rank ' + row.rank + ' of ' + D.board_size + '</span>' +
      '<h2 id="detail-title">' + esc(row.name) + '</h2>' +
      '<p class="sub">' + esc(row.category || 'Other') + ' on ' + esc(row.chains && row.chains.length ? row.chains.join(', ') : 'an unnamed chain') + '</p></div>' +
      '<button class="close" type="button" data-close="1" aria-label="Close details">Close</button></div>' +
      '<section class="detail-section"><h3>Implied value</h3>' +
      '<div class="kv">' +
      '<div><span>TVL</span><b>' + fmtUsd(row.tvl_usd) + '</b></div>' +
      '<div><span>Seven-day growth</span><b>' + fmtPct(row.change_7d) + '</b></div>' +
      '<div><span>Age with no token</span><b>' + fmtAge(row.age_days) + '</b></div>' +
      '<div><span>Category multiple</span><b>' + fmtMult(row.category_multiple) + '</b></div>' +
      '<div><span>Growth factor</span><b>' + row.growth_factor.toFixed(2) + 'x</b></div>' +
      '<div><span>Tenure factor</span><b>' + row.tenure_factor.toFixed(2) + 'x</b></div>' +
      '<div class="wide"><span>Base value (TVL x multiple)</span><b>' + fmtUsd(row.base_value_usd) + '</b></div>' +
      '<div class="wide"><span>Implied value</span><b>' + fmtUsd(row.implied_value_usd) + '</b></div>' +
      '</div>' +
      '<p class="sub" style="margin:10px 0 0">' + esc(multNote) + ' Model ' + esc(D.model_version) +
      ': the page recomputes this row as ' + fmtUsd(recomputed) + ' — ' +
      (match ? '<span class="check">the same number the board carries.</span>' : '<span class="warn">different from the board: the data would be stale.</span>') +
      ' This is an estimate, not a price.</p></section>' +
      '<section class="detail-section"><h3>Farm plan</h3>' +
      '<ol class="steps">' + stepsHtml + '</ol>' +
      '<p class="sub" style="margin:12px 0 0">Plans are derived from the protocol\'s own record — its category, chains, TVL and age — never from a hand-written list of names. Never pay to claim anything: a real claim link comes only from the protocol\'s own page.</p></section>';
    if (typeof dialog.showModal === 'function') {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }
  }

  function render() {
    app.innerHTML = '<div class="shell">' + headerHtml() + heroHtml() + controlsHtml() +
      (state.tab === 'pre-token' ? boardTableHtml() : liveTableHtml()) +
      (state.tab === 'pre-token' ? methodHtml() : '') +
      '</div>';
    app.setAttribute('aria-busy', 'false');
    if (state.selected) openDetail(state.selected);
  }

  app.addEventListener('input', function (e) {
    if (e.target && e.target.id === 'q') { state.q = e.target.value; writeHash(); render(); }
  });
  app.addEventListener('change', function (e) {
    if (e.target && e.target.id === 'category') { state.category = e.target.value; writeHash(); render(); }
  });
  app.addEventListener('click', function (e) {
    var t = e.target;
    while (t && t !== app) {
      if (t.dataset && t.dataset.tab) { state.tab = t.dataset.tab; state.selected = null; writeHash(); render(); return; }
      if (t.dataset && t.dataset.clear) { state.q = ''; state.category = 'all'; writeHash(); render(); return; }
      if (t.dataset && t.dataset.sort) {
        var key = t.dataset.sort;
        if (state.sort === key) state.dir = -state.dir;
        else { state.sort = key; state.dir = -1; }
        render();
        return;
      }
      if (t.dataset && t.dataset.slug) { openDetail(t.dataset.slug); return; }
      t = t.parentElement;
    }
  });
  app.addEventListener('keydown', function (e) {
    if ((e.key === 'Enter' || e.key === ' ') && e.target && e.target.dataset && e.target.dataset.slug) {
      e.preventDefault();
      openDetail(e.target.dataset.slug);
    }
  });
  dialog.addEventListener('click', function (e) {
    var t = e.target;
    if (t && t.dataset && t.dataset.close) { dialog.close(); }
  });
  dialog.addEventListener('close', function () { state.selected = null; writeHash(); });

  readHash();
  render();
})();
