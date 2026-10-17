// Kutopia's public Firebase web settings. Access is controlled by the database rules.
const KUTOPIA_FIREBASE = {
  apiKey: 'AIzaSyA3-oDMWUzSYOwV-yWSgPlZt0kGNUJZRPM',
  databaseURL: 'https://kutopia-high-scores-default-rtdb.firebaseio.com',
  projectId: 'kutopia-high-scores'
};
const KUTOPIA_MODE_KEYS = { Easy: 'easy', Normal: 'normal', Hard: 'hard', 'Extra Hard': 'extra' };
let onlineScoresByMode = Object.fromEntries(SCORE_MODES.map(mode => [mode, []]));
let onlineLeaderboardReady = false;
let onlineLeaderboardMessage = 'Connecting to global leaderboard…';
const onlineAuthStorageKey = 'kutopia-firebase-guest-auth-v1';

function onlineStatusElement() {
  let el = document.getElementById('online-leaderboard-status');
  if (!el) {
    el = document.createElement('p');
    el.id = 'online-leaderboard-status';
    el.setAttribute('role', 'status');
    el.style.cssText = 'margin:4px 0 10px;text-align:center;font:600 12px system-ui;color:#9bb7c6';
    document.getElementById('high-score-list')?.before(el);
  }
  return el;
}

async function firebaseAuth() {
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(onlineAuthStorageKey) || 'null'); } catch {}
  if (saved?.idToken && saved.expiresAt > Date.now() + 60000 && saved.localId) return saved;
  if (saved?.refreshToken) {
    try {
      const response = await fetch(`https://securetoken.googleapis.com/v1/token?key=${encodeURIComponent(KUTOPIA_FIREBASE.apiKey)}`, {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: saved.refreshToken })
      });
      if (response.ok) {
        const data = await response.json();
        saved = { idToken: data.id_token, refreshToken: data.refresh_token, localId: data.user_id, expiresAt: Date.now() + Number(data.expires_in || 3600) * 1000 };
        localStorage.setItem(onlineAuthStorageKey, JSON.stringify(saved));
        return saved;
      }
    } catch {}
  }
  const response = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${encodeURIComponent(KUTOPIA_FIREBASE.apiKey)}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ returnSecureToken: true })
  });
  if (!response.ok) throw new Error('Guest sign-in failed');
  const data = await response.json();
  saved = { idToken: data.idToken, refreshToken: data.refreshToken, localId: data.localId, expiresAt: Date.now() + Number(data.expiresIn || 3600) * 1000 };
  localStorage.setItem(onlineAuthStorageKey, JSON.stringify(saved));
  return saved;
}

async function loadOnlineLeaderboard() {
  try {
    const results = await Promise.all(SCORE_MODES.map(async mode => {
      const key = KUTOPIA_MODE_KEYS[mode];
      const response = await fetch(`${KUTOPIA_FIREBASE.databaseURL}/scores/${key}.json`);
      if (!response.ok) throw new Error('Leaderboard read failed');
      const data = await response.json();
      const rows = Object.values(data || {}).filter(row => row && Number.isFinite(row.score) && typeof row.name === 'string' && typeof row.hero === 'string')
        .map(row => ({ ...row, mode })).sort((a, b) => b.score - a.score).slice(0, 5);
      return [mode, rows];
    }));
    onlineScoresByMode = Object.fromEntries(results);
    onlineLeaderboardReady = true;
    onlineLeaderboardMessage = 'Global top scores · one best score per player';
  } catch {
    onlineLeaderboardReady = false;
    onlineLeaderboardMessage = 'Global scores are unavailable right now · showing scores saved on this device';
  }
  onlineStatusElement().textContent = onlineLeaderboardMessage;
  window.renderLeaderboard();
}

window.renderLeaderboard = function renderKutopiaLeaderboard() {
  const selector = document.getElementById('high-score-mode');
  if (selector) { scoreModeFilter = selector.value || scoreModeFilter; selector.value = scoreModeFilter; }
  const list = document.getElementById('high-score-list');
  if (!list) return;
  list.textContent = '';
  const rows = onlineLeaderboardReady ? (onlineScoresByMode[scoreModeFilter] || []) : (highScoresByMode[scoreModeFilter] || []);
  if (!rows.length) {
    const row = document.createElement('li');
    row.textContent = onlineLeaderboardReady ? 'No global scores yet. Be the first to set one!' : 'Finish a ' + scoreModeFilter + ' round to set the first high score!';
    list.appendChild(row);
  } else rows.forEach((entry, i) => {
    const row = document.createElement('li');
    row.textContent = (i + 1) + '. ' + (entry.name || entry.hero) + ' — ' + entry.score.toLocaleString() + ' points · ' + entry.hero;
    if (entry.photo) {
      const button = document.createElement('button');
      button.type = 'button'; button.textContent = row.textContent + ' · View photo';
      button.style.cssText = 'background:transparent;border:0;color:inherit;font:inherit;cursor:pointer;text-align:left;padding:6px';
      button.addEventListener('click', () => viewHighScorePhoto(entry));
      row.textContent = ''; row.appendChild(button);
    }
    list.appendChild(row);
  });
};

window.saveHighScore = async function saveKutopiaHighScore(name) {
  if (pendingScore === null) return;
  const mode = modeSettings().name;
  const entry = {
    score: pendingScore, hero: heroes[chosen].name, mode,
    photo: { seed: photoLayoutSeed, hero: chosen, members: familyMembers.map(m => ({ ...m })) },
    name: name.trim().slice(0, 24) || heroes[chosen].name
  };
  const local = highScoresByMode[mode] || (highScoresByMode[mode] = []);
  local.push(entry); local.sort((a, b) => b.score - a.score); local.splice(5);
  persistHighScores(); pendingScore = null;
  const selector = document.getElementById('high-score-mode');
  if (selector) { selector.value = mode; scoreModeFilter = mode; }
  document.getElementById('score-entry').classList.add('hidden');
  const savedLabel = document.getElementById('score-saved');
  savedLabel.textContent = 'Saving score online…';
  onlineStatusElement().textContent = onlineLeaderboardMessage;
  try {
    const auth = await firebaseAuth();
    const path = `${KUTOPIA_FIREBASE.databaseURL}/scores/${KUTOPIA_MODE_KEYS[mode]}/${encodeURIComponent(auth.localId)}.json`;
    const currentResponse = await fetch(path);
    if (!currentResponse.ok) throw new Error('Could not check your online score');
    const current = await currentResponse.json();
    if (!current || entry.score > current.score) {
      const response = await fetch(`${path}?auth=${encodeURIComponent(auth.idToken)}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: entry.name, hero: entry.hero, score: entry.score, submittedAt: Date.now() })
      });
      if (!response.ok) throw new Error('Could not save online score');
    }
    savedLabel.textContent = 'Score saved to the global leaderboard!';
    await loadOnlineLeaderboard();
  } catch {
    savedLabel.textContent = 'Score saved on this device. Online save failed; try again later.';
    onlineLeaderboardReady = false;
    onlineLeaderboardMessage = 'Global scores are unavailable right now · showing scores saved on this device';
    onlineStatusElement().textContent = onlineLeaderboardMessage;
    window.renderLeaderboard();
  }
  document.getElementById('score-entry').classList.add('hidden');
};

document.getElementById('high-score-mode')?.addEventListener('change', () => window.renderLeaderboard());
onlineStatusElement().textContent = onlineLeaderboardMessage;
loadOnlineLeaderboard();

