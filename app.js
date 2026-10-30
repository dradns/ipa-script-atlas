(() => {
  "use strict";

  const ATLAS = window.ATLAS;
  if (!ATLAS || !ATLAS.compare) {
    console.error("ATLAS comparison data not found");
    return;
  }

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const ORDER = ["hi", "ur", "ar", "zh"];
  const SHORT = { hi: "Хинди", ur: "Урду", ar: "Фусха", zh: "Путунхуа" };
  const SPEECH_LANG = { hi: "hi-IN", ur: "ur-PK", ar: "ar-SA", zh: "zh-CN" };
  const KIND_LABEL = { consonant: "согласный", vowel: "гласный" };

  const LANG_BY_ID = new Map(ATLAS.languages.map((lang) => [lang.id, lang]));
  const ROW_BY_ID = new Map();

  ATLAS.languages.forEach((lang) => {
    lang.groups.forEach((group) => {
      group.rows.forEach((row) => {
        row._lang = lang.id;
        row._langName = lang.name;
        row._langNative = lang.native;
        row._glyph = lang.glyph;
        row._dir = lang.dir;
        ROW_BY_ID.set(row.id, row);
      });
    });
  });

  const COMPARE = ATLAS.compare;
  const STATS = COMPARE.stats;
  const COMPARE_BY_KEY = new Map();

  COMPARE.groups.forEach((group) => {
    group.rows.forEach((item) => {
      const rows = {};
      ORDER.forEach((langId) => {
        const row = ROW_BY_ID.get(item.rows[langId]);
        if (row) rows[langId] = row;
      });
      item.rows = rows;
      item.count = Object.keys(rows).length;
      COMPARE_BY_KEY.set(item.key, item);
    });
  });

  const state = {
    filter: "all",
    onlyCommon: false,
    query: "",
    currentAudio: null,
    currentButton: null,
    drawerOpen: false,
    lastFocus: null,
  };

  const tour = { token: 0, audio: null, key: null, button: null };

  const panel = $("#lang-panel");
  const panelBody = $("#panel-body");
  const drawer = $("#drawer");
  const drawerContent = $("#drawer-content");
  const backdrop = $("#drawer-backdrop");
  const notification = $("#notification");
  let toastTimer = 0;

  /* ---------- helpers ---------- */
  function esc(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, (ch) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[ch]));
  }

  function norm(value) {
    return String(value == null ? "" : value)
      .toLowerCase()
      .replace(/[\[\]\/]/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function ipaMarkup(ipa) {
    return `<span class="br">[</span>${esc(ipa)}<span class="br">]</span>`;
  }

  function scriptClass(lang) {
    return lang.glyph || "";
  }

  function dirAttr(lang) {
    return lang.dir === "rtl" ? ' dir="rtl"' : "";
  }

  function speechLang(langId) {
    return SPEECH_LANG[langId] || "en-US";
  }

  function toast(message) {
    if (!notification) return;
    notification.textContent = message;
    notification.classList.add("show");
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => notification.classList.remove("show"), 3600);
  }

  function playIcon() {
    return `<span class="play-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M8.5 5.5v13l10-6.5-10-6.5z"/></svg></span>
      <span class="bars" aria-hidden="true"><i style="--h:6px;--d:0s"></i><i style="--h:12px;--d:.1s"></i><i style="--h:8px;--d:.2s"></i></span>`;
  }

  function checkIcon() {
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.2 4L19 7"/></svg>`;
  }

  function findCompareRow(key) {
    return $$(".compare-row", panelBody).find((el) => el.dataset.key === key) || null;
  }

  /* ---------- panel ---------- */
  function renderPanel() {
    panelBody.innerHTML = `
      <div class="lang-head compare-head">
        <div>
          <p class="eyebrow"><span class="no">00</span> сравнительная таблица · 4 языка</p>
          <h2 id="compare-title">Все звуки <span class="native">рядом</span></h2>
          <p class="lead">
            Одна таблица вместо четырёх. Для каждого звука — колонки хинди, урду,
            арабского фусха и путунхуа. Прочерк означает, что отдельного звука
            в этой системе нет; нажмите на язык, чтобы открыть карточку.
          </p>
        </div>
        <div class="facts" aria-label="Паспорт таблицы">
          <div class="fact"><span>Звуков</span><strong>${STATS.total}</strong></div>
          <div class="fact"><span>Записей</span><strong>${ATLAS.totalSounds}</strong></div>
          <div class="fact"><span>В 4 языках</span><strong>${STATS.common}</strong></div>
        </div>
      </div>

      <div class="toolbar">
        <div class="segmented" role="group" aria-label="Показать">
          <button type="button" data-filter="all" class="${state.filter === "all" ? "active" : ""}" aria-pressed="${state.filter === "all"}">Все <span>${STATS.total}</span></button>
          <button type="button" data-filter="consonants" class="${state.filter === "consonants" ? "active" : ""}" aria-pressed="${state.filter === "consonants"}">Согласные <span>${STATS.consonants}</span></button>
          <button type="button" data-filter="vowels" class="${state.filter === "vowels" ? "active" : ""}" aria-pressed="${state.filter === "vowels"}">Гласные <span>${STATS.vowels}</span></button>
        </div>
        <div class="search ${state.query ? "has-value" : ""}" id="search-wrap">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.2 4.2" stroke-linecap="round"/></svg>
          <input id="search" type="text" inputmode="search" autocomplete="off" spellcheck="false"
            placeholder="Найти звук, букву или пример…" aria-label="Поиск по атласу" value="${esc(state.query)}">
          <button class="clear" type="button" data-action="clear" aria-label="Очистить поиск">×</button>
        </div>
        <button class="toggle" id="common-toggle" type="button" aria-pressed="${state.onlyCommon}">
          <span class="box">${checkIcon()}</span>
          только общие <span class="toggle-count">${STATS.common}</span>
        </button>
        <span class="result-count" id="result-count"></span>
      </div>

      <div class="table-wrap" id="table-wrap"></div>

      <p class="table-note">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v5.5M12 7.6v.1" stroke-linecap="round"/></svg>
        <span><strong>[ ]</strong> — узкая запись конкретного звука. <strong>—</strong> в ячейке — отдельного звука в этом языке нет. Нажмите на язык, чтобы открыть карточку, или на ▶ у IPA, чтобы прослушать все доступные языки подряд.<span class="table-note-extra"><strong>Пиньинь:</strong> b/d/g — глухие непридыхательные, p/t/k — придыхательные. <strong>Урду:</strong> ھ — знак придыхания, а не отдельный [h].</span></span>
      </p>
    `;

    renderTable();
    panel.classList.remove("is-switching");
    void panelBody.offsetWidth;
    panel.classList.add("is-switching");
    window.setTimeout(() => panel.classList.remove("is-switching"), 380);
  }

  /* ---------- table ---------- */
  function itemMatches(item, q) {
    if (!q) return true;
    const parts = [item.ipa, item.desc, item.key];
    ORDER.forEach((langId) => {
      const row = item.rows[langId];
      if (!row) return;
      parts.push(
        row.letter, row.translit, row.example, row.exampleIpa,
        row.exampleTranslit, row.gloss, row.desc, row.phoneme,
        (row.tags || []).join(" ")
      );
    });
    return norm(parts.join(" ")).includes(q);
  }

  function visibleGroups() {
    const q = norm(state.query);
    const groups = [];
    COMPARE.groups.forEach((group) => {
      const groupHit = q && norm(group.title).includes(q);
      const rows = group.rows.filter((item) => {
        if (state.onlyCommon && item.count !== 4) return false;
        if (state.filter === "consonants" && item.kind !== "consonant") return false;
        if (state.filter === "vowels" && item.kind !== "vowel") return false;
        if (!q || groupHit) return true;
        return itemMatches(item, q);
      });
      if (rows.length) groups.push({ title: group.title, hint: group.hint, rows });
    });
    return groups;
  }

  function langCell(item, langId) {
    const row = item.rows[langId];
    const lang = LANG_BY_ID.get(langId);
    const label = SHORT[langId];
    if (!row) {
      return `<td class="lang-cell is-absent" data-lang="${langId}" aria-label="${esc(label)}: отдельного звука нет">
        <span class="lang-label">${esc(label)}</span>
        <span class="absent" aria-hidden="true">—</span>
        <span class="absent-note">нет</span>
      </td>`;
    }
    const glyph = scriptClass(lang);
    const dir = dirAttr(lang);
    return `<td class="lang-cell" data-lang="${langId}" data-row="${esc(row.id)}" aria-label="${esc(`${label}: ${row.letter}, ${row.example}, ${row.gloss}`)}">
      <span class="lang-label">${esc(label)}</span>
      <div class="lang-cell-head">
        <span class="letter-glyph ${glyph}" lang="${langId}"${dir}>${esc(row.letter)}</span>
        <button class="mini-play" type="button" data-play="${esc(row.id)}" data-label="Прослушать ${esc(label)}: ${esc(row.example)}" aria-label="Прослушать ${esc(label)}: ${esc(row.example)}">${playIcon()}</button>
      </div>
      <span class="example-word ${glyph}" lang="${langId}"${dir}>${esc(row.example)}</span>
      <span class="example-meta"><span class="tr">${esc(row.exampleTranslit)}</span><span class="phon">${esc(row.exampleIpa)}</span></span>
    </td>`;
  }

  function compareRow(item) {
    const available = ORDER.filter((langId) => item.rows[langId]);
    const playLabel = `Прослушать [${item.ipa}] во всех языках: ${available.length} из 4`;
    return `<tr class="compare-row" data-key="${esc(item.key)}" tabindex="0" aria-label="${esc(`[${item.ipa}], ${item.desc}`)}">
      <td class="cell-ipa">
        <div class="ipa-cell">
          <div class="ipa-line">
            <span class="ipa-symbol">${ipaMarkup(item.ipa)}</span>
            <button class="play play-all" type="button" data-tour="${esc(item.key)}" data-label="${esc(playLabel)}" aria-label="${esc(playLabel)}">${playIcon()}</button>
          </div>
          <p class="ipa-desc">${esc(item.desc)}<span class="coverage" title="${esc(`есть в ${available.length} из 4 языков`)}">${available.length}/4</span></p>
        </div>
      </td>
      ${ORDER.map((langId) => langCell(item, langId)).join("")}
    </tr>`;
  }

  function renderTable() {
    stopAudio();
    const wrap = $("#table-wrap");
    if (!wrap) return;
    const groups = visibleGroups();
    const visible = groups.reduce((sum, group) => sum + group.rows.length, 0);
    const count = $("#result-count");
    if (count) {
      const filtered = state.query || state.filter !== "all" || state.onlyCommon;
      count.textContent = filtered
        ? `Показано ${visible} из ${STATS.total}`
        : `${STATS.total} звуков`;
    }

    if (!groups.length) {
      wrap.innerHTML = `
        <div class="empty">
          <div class="sym">[ ? ]</div>
          <h3>Ничего не нашлось</h3>
          <p>Попробуйте другой знак, слово или снимите фильтры.</p>
          <button class="btn" type="button" data-action="reset">Сбросить поиск</button>
        </div>`;
      return;
    }

    const head = `<thead>
      <tr>
        <th class="col-ipa" scope="col">IPA <span class="th-note">конкретный звук</span></th>
        ${ORDER.map((langId) => {
          const lang = LANG_BY_ID.get(langId);
          return `<th class="col-lang" scope="col" data-lang="${langId}" style="--accent:${esc(lang.accent)}">
            <span class="th-native ${scriptClass(lang)}" lang="${langId}"${dirAttr(lang)}>${esc(lang.native)}</span>
            <span class="th-name">${esc(SHORT[langId])}</span>
          </th>`;
        }).join("")}
      </tr>
    </thead>`;

    const body = groups.map((group) => `
      <tr class="group-row">
        <td colspan="5">${esc(group.title)}<span class="hint">${esc(group.hint)}</span><span class="group-count">${group.rows.length}</span></td>
      </tr>
      ${group.rows.map(compareRow).join("")}
    `).join("");

    wrap.innerHTML = `
      <table class="compare-table" aria-label="Сравнительная таблица звуков четырёх языков">
        ${head}
        <tbody>${body}</tbody>
      </table>`;
  }

  /* ---------- audio ---------- */
  function resetButton(btn) {
    if (!btn) return;
    btn.classList.remove("is-playing", "playing");
    btn.setAttribute("aria-label", btn.dataset.label || "Прослушать пример");
  }

  function stopTour() {
    tour.token++;
    if (tour.audio) {
      try { tour.audio.pause(); } catch (_) { /* noop */ }
      tour.audio = null;
    }
    $$(".lang-cell.is-speaking").forEach((el) => el.classList.remove("is-speaking"));
    if (tour.button) {
      tour.button.classList.remove("is-playing");
      tour.button.setAttribute("aria-label", tour.button.dataset.label || "Прослушать звук во всех языках");
    }
    tour.key = null;
    tour.button = null;
  }

  function stopAudio() {
    stopTour();
    if (state.currentAudio) {
      try { state.currentAudio.pause(); } catch (_) { /* noop */ }
      state.currentAudio = null;
    }
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    resetButton(state.currentButton);
    state.currentButton = null;
    const hero = $("#hero-play");
    if (hero) hero.classList.remove("is-playing", "playing");
  }

  function speakFallback(row, onDone) {
    if (!row) { onDone && onDone(); return; }
    if (!("speechSynthesis" in window)) {
      toast("Браузер не поддерживает озвучивание. Пример записан в строке.");
      onDone && onDone();
      return;
    }
    const utter = new SpeechSynthesisUtterance(row.example);
    utter.lang = speechLang(row._lang);
    utter.rate = 0.82;
    utter.pitch = 1;
    utter.onend = () => onDone && onDone();
    utter.onerror = () => {
      toast("Аудиофайл не найден. Проверьте папку assets/audio рядом с index.html.");
      onDone && onDone();
    };
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utter);
  }

  function playRow(row, btn) {
    if (!row) return;
    if (state.currentButton === btn && state.currentAudio) {
      stopAudio();
      return;
    }
    stopAudio();

    state.currentButton = btn;
    btn.classList.add("is-playing");
    btn.setAttribute("aria-label", "Остановить озвучивание");

    let usedFallback = false;
    const done = () => {
      btn.classList.remove("is-playing");
      btn.setAttribute("aria-label", btn.dataset.label || "Прослушать пример");
      if (state.currentButton === btn) state.currentButton = null;
    };

    const audio = new Audio(row.audio);
    state.currentAudio = audio;
    audio.preload = "auto";
    audio.onended = done;
    audio.onerror = () => {
      if (usedFallback) return;
      usedFallback = true;
      speakFallback(row, done);
    };
    const promise = audio.play();
    if (promise && typeof promise.catch === "function") {
      promise.catch(() => {
        if (usedFallback) return;
        usedFallback = true;
        speakFallback(row, done);
      });
    }
  }

  function playTour(key, btn) {
    if (tour.key === key) {
      stopAudio();
      return;
    }
    stopAudio();
    const item = COMPARE_BY_KEY.get(key);
    if (!item) return;
    const langs = ORDER.filter((langId) => item.rows[langId]);
    if (!langs.length) return;

    const token = ++tour.token;
    tour.key = key;
    tour.button = btn;
    btn.classList.add("is-playing");
    btn.setAttribute("aria-label", "Остановить озвучивание");

    let index = 0;
    const finish = () => {
      if (tour.key !== key) return;
      btn.classList.remove("is-playing");
      btn.setAttribute("aria-label", btn.dataset.label || "Прослушать звук во всех языках");
      tour.key = null;
      tour.button = null;
      tour.audio = null;
    };

    const next = () => {
      if (token !== tour.token) return;
      if (index >= langs.length) {
        finish();
        return;
      }
      const langId = langs[index++];
      const row = item.rows[langId];
      const cell = findCompareRow(key)?.querySelector(`.lang-cell[data-lang="${langId}"]`);
      if (cell) cell.classList.add("is-speaking");
      const audio = new Audio(row.audio);
      tour.audio = audio;
      const done = () => {
        if (cell) cell.classList.remove("is-speaking");
        if (token !== tour.token) return;
        window.setTimeout(next, 160);
      };
      audio.onended = done;
      audio.onerror = done;
      audio.play().catch(done);
    };

    next();
  }

  function playHero() {
    const btn = $("#hero-play");
    if (!btn) return;
    if (btn.classList.contains("is-playing")) {
      stopAudio();
      return;
    }
    stopAudio();
    btn.classList.add("is-playing", "playing");
    state.currentButton = btn;

    let usedFallback = false;
    const done = () => btn.classList.remove("is-playing", "playing");
    const audio = new Audio("assets/audio/hi-c01.mp3");
    state.currentAudio = audio;
    audio.onended = done;
    audio.onerror = () => {
      if (usedFallback) return;
      usedFallback = true;
      speakFallback(ROW_BY_ID.get("hi-c01"), done);
    };
    const p = audio.play();
    if (p && typeof p.catch === "function") {
      p.catch(() => {
        if (usedFallback) return;
        usedFallback = true;
        speakFallback(ROW_BY_ID.get("hi-c01"), done);
      });
    }
  }

  /* ---------- drawer ---------- */
  function findCross(row) {
    const result = [];
    ROW_BY_ID.forEach((other) => {
      if (other.ipa === row.ipa && other._lang !== row._lang) result.push(other);
    });
    return result;
  }

  function openDrawer(rowId) {
    const row = ROW_BY_ID.get(rowId);
    if (!row) return;
    const lang = LANG_BY_ID.get(row._lang);
    if (!lang) return;

    stopAudio();
    state.lastFocus = document.activeElement;
    const cross = findCross(row);
    const script = scriptClass(lang);

    drawerContent.innerHTML = `
      <div class="drawer-top">
        <span class="drawer-label">${esc(lang.name)} · ${KIND_LABEL[row.kind] || "звук"}</span>
        <button class="drawer-close" type="button" data-action="close-drawer" aria-label="Закрыть карточку">×</button>
      </div>
      <div class="drawer-sound">
        <div class="ipa-symbol" aria-label="Звук ${esc(row.ipa)}">${ipaMarkup(row.ipa)}</div>
        <button class="play" type="button" data-play="${esc(row.id)}" aria-label="Прослушать пример: ${esc(row.example)}">${playIcon()}</button>
      </div>
      <h3 id="drawer-title">${esc(row.desc)}</h3>
      <div class="chip-row">
        ${row.tags.map((tag) => `<span class="chip${tag === "придыхательный" || tag === "эмфатический" ? " accent" : ""}">${esc(tag)}</span>`).join("")}
      </div>
      <div class="drawer-card">
        <div class="drawer-fact"><span>Фонема</span><strong class="ipa">/${esc(row.phoneme)}/</strong></div>
        <div class="drawer-fact"><span>Письмо</span><strong class="script ${script}" lang="${lang.id}"${dirAttr(lang)}>${esc(row.letter)}</strong></div>
        <div class="drawer-fact"><span>Пример</span><strong class="script ${script}" lang="${lang.id}"${dirAttr(lang)}>${esc(row.example)}</strong></div>
        <div class="drawer-fact"><span>Запись</span><strong class="ipa">${esc(row.exampleIpa)}</strong></div>
      </div>
      ${row.note ? `<p class="drawer-note"><strong>Подсказка.</strong> ${esc(row.note)}</p>` : ""}
      ${row.variants ? `<p class="drawer-note"><strong>Варианты.</strong> ${esc(row.variants)}</p>` : ""}
      <div class="drawer-actions">
        <button class="btn btn-primary" type="button" data-play="${esc(row.id)}">
          <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8.5 5.5v13l10-6.5-10-6.5z"/></svg>
          Прослушать пример
        </button>
        <button class="btn" type="button" data-action="close-drawer">Закрыть</button>
      </div>
      <div class="drawer-section-title">тот же звук в других языках</div>
      <div class="cross-list">
        ${cross.length ? cross.map((other) => {
          const otherLang = LANG_BY_ID.get(other._lang);
          const otherScript = scriptClass(otherLang);
          return `<button class="cross-item" type="button" data-jump="${esc(other._lang)}:${esc(other.id)}">
            <span class="letter ${otherScript}" lang="${other._lang}"${dirAttr(otherLang)}>${esc(other.letter)}</span>
            <span class="meta"><strong>${esc(otherLang.name)}</strong><small>${esc(other.example)} · ${esc(other.gloss)}</small></span>
            <span class="ipa-small">[${esc(other.ipa)}]</span>
          </button>`;
        }).join("") : `<p class="cross-empty">Точного совпадения среди четырёх языков нет. Сравните артикуляцию и ближайшие звуки вручную.</p>`}
      </div>
      <p class="drawer-footnote">
        Фонема записана в косых чертах, реальный звук — в квадратных скобках.
        Описание артикуляции учебное; в беглой речи возможны позиционные изменения.
      </p>
    `;

    state.drawerOpen = true;
    drawer.setAttribute("aria-hidden", "false");
    drawer.inert = false;
    backdrop.hidden = false;
    document.body.classList.add("drawer-open");
    window.requestAnimationFrame(() => {
      drawer.classList.add("is-open");
      const close = drawer.querySelector("[data-action='close-drawer']");
      if (close) close.focus();
    });
  }

  function closeDrawer() {
    if (!state.drawerOpen) return;
    state.drawerOpen = false;
    drawer.classList.remove("is-open");
    drawer.setAttribute("aria-hidden", "true");
    drawer.inert = true;
    document.body.classList.remove("drawer-open");
    window.setTimeout(() => { backdrop.hidden = true; }, 300);
    if (state.lastFocus && typeof state.lastFocus.focus === "function") {
      state.lastFocus.focus();
    }
  }

  function focusCompareRow(rowEl, langId) {
    if (!rowEl) return;
    rowEl.scrollIntoView({ behavior: "smooth", block: "center" });
    rowEl.classList.add("is-flash");
    const cell = langId ? rowEl.querySelector(`.lang-cell[data-lang="${langId}"]`) : null;
    if (cell) cell.classList.add("is-focus");
    window.setTimeout(() => {
      rowEl.classList.remove("is-flash");
      if (cell) cell.classList.remove("is-focus");
    }, 1800);
  }

  function jumpTo(spec) {
    const [langId, rowId] = String(spec).split(":");
    const row = ROW_BY_ID.get(rowId);
    if (!row) return;
    closeDrawer();
    window.setTimeout(() => {
      let rowEl = findCompareRow(row.ipa);
      if (!rowEl) {
        state.query = "";
        state.filter = "all";
        state.onlyCommon = false;
        renderPanel();
        window.setTimeout(() => {
          rowEl = findCompareRow(row.ipa);
          if (rowEl) focusCompareRow(rowEl, langId);
        }, 100);
      } else {
        focusCompareRow(rowEl, langId);
      }
    }, 180);
  }

  /* ---------- events ---------- */
  panelBody.addEventListener("click", (event) => {
    const tourBtn = event.target.closest("[data-tour]");
    if (tourBtn) {
      event.stopPropagation();
      playTour(tourBtn.dataset.tour, tourBtn);
      return;
    }
    const play = event.target.closest("[data-play]");
    if (play) {
      event.stopPropagation();
      playRow(ROW_BY_ID.get(play.dataset.play), play);
      return;
    }
    const clear = event.target.closest("[data-action='clear']");
    if (clear) {
      state.query = "";
      const input = $("#search");
      if (input) input.value = "";
      const wrap = $("#search-wrap");
      if (wrap) wrap.classList.remove("has-value");
      renderTable();
      if (input) input.focus();
      return;
    }
    const reset = event.target.closest("[data-action='reset']");
    if (reset) {
      state.query = "";
      state.filter = "all";
      state.onlyCommon = false;
      renderPanel();
      return;
    }
    const filter = event.target.closest("[data-filter]");
    if (filter) {
      state.filter = filter.dataset.filter;
      $$(".segmented button", panelBody).forEach((btn) => {
        const active = btn.dataset.filter === state.filter;
        btn.classList.toggle("active", active);
        btn.setAttribute("aria-pressed", String(active));
      });
      renderTable();
      return;
    }
    if (event.target.closest("#common-toggle")) {
      state.onlyCommon = !state.onlyCommon;
      const toggle = $("#common-toggle");
      if (toggle) toggle.setAttribute("aria-pressed", String(state.onlyCommon));
      renderTable();
      return;
    }
    const cell = event.target.closest(".lang-cell");
    if (cell && cell.dataset.row) {
      openDrawer(cell.dataset.row);
      return;
    }
    const ipaCell = event.target.closest(".cell-ipa");
    if (ipaCell) {
      const rowEl = ipaCell.closest(".compare-row");
      const item = COMPARE_BY_KEY.get(rowEl?.dataset.key);
      const first = item && ORDER.find((langId) => item.rows[langId]);
      if (first) openDrawer(item.rows[first].id);
      return;
    }
    const rowEl = event.target.closest(".compare-row");
    if (rowEl) {
      const item = COMPARE_BY_KEY.get(rowEl.dataset.key);
      const first = item && ORDER.find((langId) => item.rows[langId]);
      if (first) openDrawer(item.rows[first].id);
    }
  });

  panelBody.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    if (event.target.closest("button, input, a")) return;
    const rowEl = event.target.closest(".compare-row");
    if (!rowEl) return;
    const item = COMPARE_BY_KEY.get(rowEl.dataset.key);
    const first = item && ORDER.find((langId) => item.rows[langId]);
    if (!first) return;
    event.preventDefault();
    openDrawer(item.rows[first].id);
  });

  panelBody.addEventListener("input", (event) => {
    if (event.target.id !== "search") return;
    state.query = event.target.value;
    const wrap = $("#search-wrap");
    if (wrap) wrap.classList.toggle("has-value", Boolean(state.query));
    renderTable();
  });

  $("#hero-play")?.addEventListener("click", playHero);

  drawer.addEventListener("click", (event) => {
    const close = event.target.closest("[data-action='close-drawer']");
    if (close) { closeDrawer(); return; }
    const play = event.target.closest("[data-play]");
    if (play) {
      playRow(ROW_BY_ID.get(play.dataset.play), play);
      return;
    }
    const jump = event.target.closest("[data-jump]");
    if (jump) jumpTo(jump.dataset.jump);
  });

  backdrop.addEventListener("click", closeDrawer);

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && state.drawerOpen) {
      event.preventDefault();
      closeDrawer();
      return;
    }
    if (event.key !== "Tab" || !state.drawerOpen) return;
    const focusables = $$("button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])", drawer)
      .filter((el) => !el.disabled && el.offsetParent !== null);
    if (!focusables.length) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });

  /* ---------- boot ---------- */
  renderPanel();
  drawer.inert = true;
  backdrop.hidden = true;

  if ("IntersectionObserver" in window) {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.12 });
    $$(".reveal").forEach((el) => observer.observe(el));
  } else {
    $$(".reveal").forEach((el) => el.classList.add("is-visible"));
  }
})();
