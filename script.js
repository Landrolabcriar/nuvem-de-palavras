// Troque a URL e a chave publica pelos dados do seu projeto Supabase, se necessario.
const SUPABASE_URL = "https://hywziogusopayughgddt.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_lWOy9UtBAHXrFsSBSLMDWQ_LiYjgDuW";
const TABLE_NAME = "palavras_nuvem";
const MAX_WORD_LENGTH = 20;
const MAX_WORDS = 80;
const WORD_LIFETIME_MS = 2 * 60 * 1000;
const MAX_FONT_SIZE = 68;
const WORD_COLORS = ["#b69cff", "#4de8f2", "#a9f45b", "#ff76bd", "#ffe36e"];

const elements = {
  form: document.querySelector("#word-form"),
  input: document.querySelector("#word-input"),
  inputCount: document.querySelector("#input-count"),
  submit: document.querySelector("#submit-button"),
  cloud: document.querySelector("#cloud"),
  wordCount: document.querySelector("#word-count"),
  connection: document.querySelector("#connection"),
  connectionLabel: document.querySelector("#connection-label"),
  toast: document.querySelector("#toast")
};

const supabaseClient = window.supabase?.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const wordsByText = new Map();
const processedIds = new Set();
let toastTimer;

function showToast(message) {
  elements.toast.textContent = message;
  elements.toast.classList.add("visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => elements.toast.classList.remove("visible"), 3500);
}

function setConnectionStatus(status) {
  const connected = status === "SUBSCRIBED";
  const connecting = status === "CONNECTING" || status === "CLOSED";
  elements.connection.classList.toggle("connected", connected);
  elements.connection.classList.toggle("connecting", connecting);
  elements.connection.classList.toggle("disconnected", !connected && !connecting);
  elements.connectionLabel.textContent = connected
    ? "Conectado"
    : connecting ? "Conectando..." : "Desconectado";
}

function updateWordCount() {
  elements.wordCount.textContent = String(wordsByText.size);
}

function removeWord(entry) {
  if (wordsByText.get(entry.text) !== entry) return;
  clearTimeout(entry.expirationTimer);
  clearTimeout(entry.fadeTimer);
  entry.element.remove();
  wordsByText.delete(entry.text);
  updateWordCount();
}

function beginFade(entry) {
  if (wordsByText.get(entry.text) !== entry || entry.isFading) return;
  entry.isFading = true;
  entry.element.classList.add("is-fading");
  entry.fadeTimer = setTimeout(() => removeWord(entry), 750);
}

function scheduleExpiration(entry) {
  clearTimeout(entry.expirationTimer);
  entry.expirationTimer = setTimeout(
    () => beginFade(entry),
    Math.max(0, entry.expiresAt - Date.now())
  );
}

function pulseWord(entry, { extendLifetime = false, expiration = 0 } = {}) {
  if (entry.isFading) {
    clearTimeout(entry.fadeTimer);
    entry.element.classList.remove("is-fading");
    entry.isFading = false;
  }

  entry.fontSize = Math.min(entry.fontSize + 4, MAX_FONT_SIZE);
  entry.label.style.fontSize = `${entry.fontSize}px`;
  entry.element.classList.remove("is-pulsing");
  void entry.element.offsetWidth;
  entry.element.classList.add("is-pulsing");
  entry.element.addEventListener("animationend", () => {
    entry.element.classList.remove("is-pulsing");
  }, { once: true });

  if (extendLifetime && expiration > entry.expiresAt) {
    entry.expiresAt = expiration;
    scheduleExpiration(entry);
  }
}

function randomPosition(minimum, maximum) {
  return minimum + Math.random() * (maximum - minimum);
}

function registerProcessedId(id) {
  const key = String(id);
  if (processedIds.has(key)) return false;
  processedIds.add(key);
  if (processedIds.size > 500) processedIds.delete(processedIds.values().next().value);
  return true;
}

function createOrUpdateWord(record) {
  if (!record || record.id === undefined || record.id === null) return;
  if (!registerProcessedId(record.id)) return;

  const text = typeof record.texto === "string"
    ? record.texto.trim().replace(/\s+/g, " ").toLocaleLowerCase("pt-BR").slice(0, MAX_WORD_LENGTH)
    : "";
  if (!text) return;

  const createdAt = Date.parse(record.created_at) || Date.now();
  const expiresAt = createdAt + WORD_LIFETIME_MS;
  const existing = wordsByText.get(text);
  if (existing) {
    pulseWord(existing, { extendLifetime: true, expiration: expiresAt });
    return;
  }

  while (wordsByText.size >= MAX_WORDS) {
    const oldest = [...wordsByText.values()].reduce(
      (candidate, word) => word.createdAt < candidate.createdAt ? word : candidate
    );
    removeWord(oldest);
  }

  const color = /^#[\da-f]{6}$/i.test(record.cor || "")
    ? record.cor
    : WORD_COLORS[Math.floor(Math.random() * WORD_COLORS.length)];
  const posX = record.pos_x !== null
    && record.pos_x !== undefined
    && Number.isFinite(Number(record.pos_x))
    ? Math.min(90, Math.max(10, Number(record.pos_x)))
    : randomPosition(10, 80);
  const posY = record.pos_y !== null
    && record.pos_y !== undefined
    && Number.isFinite(Number(record.pos_y))
    ? Math.min(80, Math.max(10, Number(record.pos_y)))
    : randomPosition(15, 75);
  const fontSize = 23 + Math.random() * 10;

  const element = document.createElement("div");
  element.className = "cloud-word";
  element.style.left = `${posX}%`;
  element.style.top = `${posY}%`;

  const label = document.createElement("span");
  label.className = "word-label";
  label.textContent = text;
  label.style.color = color;
  label.style.fontSize = `${fontSize}px`;
  label.style.setProperty("--float-time", `${3.4 + Math.random() * 2.4}s`);
  label.style.setProperty("--float-delay", `${-Math.random() * 3}s`);
  element.append(label);
  elements.cloud.append(element);

  const entry = {
    text,
    element,
    label,
    fontSize,
    createdAt,
    expiresAt,
    isFading: false,
    expirationTimer: null,
    fadeTimer: null
  };
  wordsByText.set(text, entry);
  scheduleExpiration(entry);
  updateWordCount();
}

async function loadRecentWords() {
  const cutoff = new Date(Date.now() - WORD_LIFETIME_MS).toISOString();
  const { data, error } = await supabaseClient
    .from(TABLE_NAME)
    .select("id,texto,cor,pos_x,pos_y,created_at")
    .gte("created_at", cutoff)
    .order("created_at", { ascending: true })
    .limit(MAX_WORDS);

  if (error) {
    showToast(`Não foi possível carregar a nuvem: ${error.message}`);
    return;
  }
  data.forEach(createOrUpdateWord);
}

async function addWord(event) {
  event.preventDefault();
  const text = elements.input.value
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleLowerCase("pt-BR")
    .slice(0, MAX_WORD_LENGTH);

  if (!text) {
    showToast("Digite uma palavra antes de enviar.");
    elements.input.focus();
    return;
  }

  const existing = wordsByText.get(text);
  if (existing) {
    pulseWord(existing);
    elements.input.value = "";
    elements.inputCount.textContent = `0/${MAX_WORD_LENGTH}`;
    elements.input.focus();
    return;
  }

  if (!supabaseClient) {
    showToast("O cliente Supabase não carregou. Atualize a página e tente novamente.");
    return;
  }

  const word = {
    texto: text,
    cor: WORD_COLORS[Math.floor(Math.random() * WORD_COLORS.length)],
    pos_x: randomPosition(10, 80),
    pos_y: randomPosition(15, 75)
  };

  elements.submit.disabled = true;
  try {
    const { data, error } = await supabaseClient
      .from(TABLE_NAME)
      .insert(word)
      .select("id,texto,cor,pos_x,pos_y,created_at")
      .single();
    if (error) throw error;

    createOrUpdateWord(data);
    elements.input.value = "";
    elements.inputCount.textContent = `0/${MAX_WORD_LENGTH}`;
    elements.input.focus();
  } catch (error) {
    showToast(`Não foi possível enviar: ${error.message}`);
  } finally {
    elements.submit.disabled = false;
  }
}

elements.form.addEventListener("submit", addWord);
elements.input.addEventListener("input", () => {
  elements.inputCount.textContent = `${elements.input.value.length}/${MAX_WORD_LENGTH}`;
});

if (supabaseClient) {
  supabaseClient
    .channel("nuvem-de-palavras")
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: TABLE_NAME },
      payload => createOrUpdateWord(payload.new)
    )
    .subscribe(status => {
      setConnectionStatus(status);
      if (status === "SUBSCRIBED") loadRecentWords();
    });
} else {
  setConnectionStatus("CHANNEL_ERROR");
  showToast("Não foi possível carregar o cliente Supabase.");
}
