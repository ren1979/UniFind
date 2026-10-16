'use strict';

const STORAGE_KEYS = {
  favorites: 'unifind:favorites',
  recent: 'unifind:recent',
  noticeDismissed: 'unifind:notice-dismissed'
};

const state = {
  results: [],
  selectedIndex: 0,
  searchId: 0,
  latestRenderedId: 0,
  ready: false,
  totalCount: 0,
  favorites: loadNumberList(STORAGE_KEYS.favorites),
  recent: loadNumberList(STORAGE_KEYS.recent),
  toastTimer: null,
  queryTimer: null
};

const elements = {
  input: document.querySelector('#search-input'),
  resultList: document.querySelector('#result-list'),
  resultTitle: document.querySelector('#result-title'),
  resultCount: document.querySelector('#result-count'),
  detailPanel: document.querySelector('#detail-panel'),
  largeGlyph: document.querySelector('#large-glyph'),
  characterName: document.querySelector('#character-name'),
  codepointBadge: document.querySelector('#codepoint-badge'),
  categoryBadge: document.querySelector('#category-badge'),
  blockValue: document.querySelector('#block-value'),
  htmlValue: document.querySelector('#html-value'),
  jsValue: document.querySelector('#js-value'),
  favoriteButton: document.querySelector('#favorite-button'),
  insertButton: document.querySelector('#insert-button'),
  copyButton: document.querySelector('#copy-button'),
  notice: document.querySelector('#notice'),
  noticeText: document.querySelector('#notice-text'),
  noticeClose: document.querySelector('#notice-close'),
  unicodeVersion: document.querySelector('#unicode-version'),
  toast: document.querySelector('#toast')
};

const worker = new Worker('./search-worker.js');

function loadNumberList(key) {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || '[]');
    return Array.isArray(parsed) ? parsed.filter(Number.isInteger) : [];
  } catch {
    return [];
  }
}

function saveNumberList(key, values) {
  localStorage.setItem(key, JSON.stringify(values));
}

function titleCase(value) {
  return value.toLowerCase().replace(/(^|[\s-])\p{L}/gu, (letter) => letter.toUpperCase());
}

function glyphPresentation(record) {
  if (record.category.startsWith('M')) return { text: `◌${record.char}`, placeholder: false };
  if (record.category === 'Zs') {
    const labels = { '0020': 'SP', '00A0': 'NBSP', '2009': 'THIN', '200A': 'HAIR' };
    return { text: labels[record.hex] || 'SPACE', placeholder: true };
  }
  if (record.category.startsWith('C')) {
    const abbreviation = record.name
      .split(/[ -]/)
      .filter((word) => !['CHARACTER', 'CONTROL'].includes(word))
      .map((word) => word[0])
      .join('')
      .slice(0, 5);
    return { text: abbreviation || 'CTRL', placeholder: true };
  }
  return { text: record.char, placeholder: false };
}

function selectedRecord() {
  return state.results[state.selectedIndex] || null;
}

function isFavorite(codePoint) {
  return state.favorites.includes(codePoint);
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function renderResults() {
  elements.resultList.replaceChildren();
  const query = elements.input.value.trim();
  elements.resultTitle.textContent = query ? 'Search results' : 'Recent & popular';
  elements.resultCount.textContent = state.results.length
    ? `${state.results.length} shown`
    : state.ready ? 'No matches' : 'Loading Unicode data…';

  if (state.results.length === 0) {
    const empty = element('div', state.ready ? 'empty-state' : 'loading-state');
    if (state.ready) {
      empty.append(element('span', 'empty-symbol', '⌁'));
      empty.append(element('span', '', 'No characters matched. Try a name like “arrow” or a code such as “U+2192”.'));
    } else {
      empty.append(element('span', 'spinner'));
      empty.append(element('span', '', 'Preparing the character index…'));
    }
    elements.resultList.append(empty);
    elements.detailPanel.style.opacity = '0.45';
    return;
  }

  elements.detailPanel.style.opacity = '1';
  state.results.forEach((record, index) => {
    const button = element('button', `result-item${index === state.selectedIndex ? ' selected' : ''}`);
    button.type = 'button';
    button.dataset.index = String(index);
    button.role = 'option';
    button.setAttribute('aria-selected', index === state.selectedIndex ? 'true' : 'false');

    const presentation = glyphPresentation(record);
    const glyph = element('span', `result-glyph${presentation.placeholder ? ' placeholder' : ''}`, presentation.text);
    const copy = element('span', 'result-copy');
    copy.append(element('span', 'result-name', titleCase(record.name)));
    const meta = element('span', 'result-meta');
    if (isFavorite(record.cp)) meta.append(element('span', 'favorite-dot', '★'));
    meta.append(element('span', '', record.block));
    copy.append(meta);
    const codePoint = element('span', 'result-codepoint', `U+${record.hex}`);
    button.append(glyph, copy, codePoint);

    button.addEventListener('mouseenter', () => selectIndex(index, false));
    button.addEventListener('click', () => selectIndex(index, true));
    button.addEventListener('dblclick', insertSelected);
    elements.resultList.append(button);
  });

  renderDetail();
}

function renderDetail() {
  const record = selectedRecord();
  if (!record) return;
  const presentation = glyphPresentation(record);
  elements.largeGlyph.textContent = presentation.text;
  elements.largeGlyph.classList.toggle('placeholder', presentation.placeholder);
  elements.characterName.textContent = titleCase(record.name);
  elements.codepointBadge.textContent = `U+${record.hex}`;
  elements.categoryBadge.textContent = record.category;
  elements.categoryBadge.title = categoryName(record.category);
  elements.blockValue.textContent = record.block;
  elements.htmlValue.textContent = `&#x${record.hex};`;
  elements.jsValue.textContent = `\\u{${record.hex}}`;
  const favorite = isFavorite(record.cp);
  elements.favoriteButton.classList.toggle('active', favorite);
  elements.favoriteButton.setAttribute('aria-label', favorite ? 'Remove from favorites' : 'Add to favorites');
  elements.favoriteButton.title = favorite ? 'Remove from favorites' : 'Add to favorites';
}

function categoryName(category) {
  const names = {
    Lu: 'Uppercase letter', Ll: 'Lowercase letter', Lt: 'Titlecase letter', Lm: 'Modifier letter', Lo: 'Other letter',
    Mn: 'Nonspacing mark', Mc: 'Spacing mark', Me: 'Enclosing mark',
    Nd: 'Decimal number', Nl: 'Letter number', No: 'Other number',
    Pc: 'Connector punctuation', Pd: 'Dash punctuation', Ps: 'Open punctuation', Pe: 'Close punctuation',
    Pi: 'Initial punctuation', Pf: 'Final punctuation', Po: 'Other punctuation',
    Sm: 'Math symbol', Sc: 'Currency symbol', Sk: 'Modifier symbol', So: 'Other symbol',
    Zs: 'Space separator', Zl: 'Line separator', Zp: 'Paragraph separator',
    Cc: 'Control', Cf: 'Format'
  };
  return names[category] || category;
}

function selectIndex(index, scrollIntoView) {
  if (index < 0 || index >= state.results.length) return;
  state.selectedIndex = index;
  const items = elements.resultList.querySelectorAll('.result-item');
  items.forEach((item, itemIndex) => {
    const selected = itemIndex === index;
    item.classList.toggle('selected', selected);
    item.setAttribute('aria-selected', selected ? 'true' : 'false');
  });
  if (scrollIntoView) items[index]?.scrollIntoView({ block: 'nearest' });
  renderDetail();
}

function requestSearch(immediate = false) {
  window.clearTimeout(state.queryTimer);
  const run = () => {
    state.searchId += 1;
    worker.postMessage({
      type: 'search',
      id: state.searchId,
      query: elements.input.value,
      recent: state.recent,
      favorites: state.favorites,
      limit: 80
    });
  };

  if (immediate) run();
  else state.queryTimer = window.setTimeout(run, 32);
}

function remember(record) {
  state.recent = [record.cp, ...state.recent.filter((cp) => cp !== record.cp)].slice(0, 32);
  saveNumberList(STORAGE_KEYS.recent, state.recent);
}

async function insertSelected() {
  const record = selectedRecord();
  if (!record) return;
  remember(record);
  const response = await window.unifind.chooseCharacter(record.char, true);
  // On a successful paste the window is hidden, so no toast is needed. When
  // auto-paste is unavailable the window stays open and we tell the user the
  // character is on the clipboard so they can paste it manually.
  if (response?.ok && response.mode === 'copied') {
    showToast(`Copied ${record.char} — press Ctrl+V to paste`);
  }
}

async function copyText(value, message = 'Copied to clipboard') {
  const response = await window.unifind.chooseCharacter(value, false);
  if (response.ok) showToast(message);
}

function copySelected() {
  const record = selectedRecord();
  if (!record) return;
  remember(record);
  copyText(record.char, `Copied ${record.char}`);
}

function toggleFavorite() {
  const record = selectedRecord();
  if (!record) return;
  if (isFavorite(record.cp)) {
    state.favorites = state.favorites.filter((cp) => cp !== record.cp);
    showToast('Removed from favorites');
  } else {
    state.favorites = [record.cp, ...state.favorites];
    showToast('Added to favorites');
  }
  saveNumberList(STORAGE_KEYS.favorites, state.favorites);
  renderResults();
}

function showToast(message) {
  window.clearTimeout(state.toastTimer);
  elements.toast.textContent = message;
  elements.toast.classList.add('visible');
  state.toastTimer = window.setTimeout(() => elements.toast.classList.remove('visible'), 1350);
}

function formatShortcut(shortcut) {
  if (!shortcut) return '';
  return shortcut.replace('CommandOrControl', navigator.platform.includes('Mac') ? 'Cmd' : 'Ctrl');
}

function displayStatus(status) {
  if (localStorage.getItem(STORAGE_KEYS.noticeDismissed) === 'true') return;
  if (!status.shortcutRegistered) {
    elements.noticeText.textContent = 'Ctrl+, could not be registered. Open UniFind from the tray, then close the conflicting app and restart.';
    elements.notice.hidden = false;
  } else if (status.activeShortcut !== status.requestedShortcut) {
    elements.noticeText.textContent = `Ctrl+, is unavailable, so ${formatShortcut(status.activeShortcut)} is active instead.`;
    elements.notice.hidden = false;
  }
}

worker.onmessage = ({ data }) => {
  if (data.type === 'ready') {
    state.ready = true;
    state.totalCount = data.count;
    elements.unicodeVersion.textContent = `Unicode ${data.version}`;
    document.documentElement.dataset.unicodeReady = 'true';
    requestSearch(true);
    return;
  }

  if (data.type === 'error') {
    state.ready = true;
    elements.resultList.replaceChildren();
    const error = element('div', 'empty-state');
    error.append(element('span', 'empty-symbol', '!'));
    error.append(element('span', '', `The Unicode database could not be loaded: ${data.message}`));
    elements.resultList.append(error);
    elements.resultCount.textContent = 'Database error';
    return;
  }

  if (data.type === 'results' && data.id >= state.latestRenderedId) {
    state.latestRenderedId = data.id;
    state.results = data.results;
    state.selectedIndex = 0;
    renderResults();
    document.documentElement.dataset.resultsReady = 'true';
  }
};

elements.input.addEventListener('input', requestSearch);
elements.insertButton.addEventListener('click', insertSelected);
elements.copyButton.addEventListener('click', copySelected);
elements.favoriteButton.addEventListener('click', toggleFavorite);
elements.noticeClose.addEventListener('click', () => {
  elements.notice.hidden = true;
  localStorage.setItem(STORAGE_KEYS.noticeDismissed, 'true');
});

document.querySelectorAll('.copy-value').forEach((button) => {
  button.addEventListener('click', () => {
    const target = document.querySelector(`#${button.dataset.copyTarget}`);
    copyText(target.textContent, 'Escape copied');
  });
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    event.preventDefault();
    window.unifind.hide();
    return;
  }

  if (event.key === 'ArrowDown') {
    event.preventDefault();
    selectIndex(Math.min(state.selectedIndex + 1, state.results.length - 1), true);
    return;
  }

  if (event.key === 'ArrowUp') {
    event.preventDefault();
    selectIndex(Math.max(state.selectedIndex - 1, 0), true);
    return;
  }

  if (event.key === 'Enter') {
    event.preventDefault();
    insertSelected();
    return;
  }

  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'c') {
    event.preventDefault();
    copySelected();
  }
});

window.unifind.onPopupShown((status) => {
  elements.input.value = '';
  elements.input.focus();
  elements.input.select();
  displayStatus(status);
  if (state.ready) requestSearch(true);
});

window.unifind.getAppStatus().then(displayStatus);
elements.input.focus();
