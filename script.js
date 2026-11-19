// Troque a URL e a chave publica pelos dados do seu projeto Supabase, se necessario.
const SUPABASE_URL = "https://hywziogusopayughgddt.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_lWOy9UtBAHXrFsSBSLMDWQ_LiYjgDuW";
const TABLE_NAME = "palavras_nuvem";
const MAX_WORD_LENGTH = 20;
const MAX_WORDS = 80;
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

function evictOldestWord() {
  const oldest = [...wordsByText.values()].reduce(
    (candidate, word) => word.createdAt < candidate.createdAt ? word : candidate
  );
  if (!oldest) return;

  wordsByText.delete(oldest.text);
  oldest.element.remove();
  updateWordCount();
}

function growWord(entry) {
  entry.fontSize = Math.min(entry.fontSize + 4, MAX_FONT_SIZE);
  entry.label.style.fontSize = `${entry.fontSize}px`;
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
  const existing = wordsByText.get(text);
  if (existing) {
    growWord(existing);
    return;
  }

  while (wordsByText.size >= MAX_WORDS) {
    evictOldestWord();
  }

  const color = /^#[\da-f]{6}$/i.test(record.cor || "")
    ? record.cor
    : WORD_COLORS[Math.floor(Math.random() * WORD_COLORS.length)];
  const fontSize = 23 + Math.random() * 10;

  const element = document.createElement("div");
  element.className = "cloud-word";

  const label = document.createElement("span");
  label.className = "word-label";
  label.textContent = text;
  label.style.color = color;
  label.style.fontSize = `${fontSize}px`;
  label.style.setProperty("--float-time", `${3.4 + Math.random() * 2.4}s`);
  label.style.setProperty("--float-delay", `${-Math.random() * 3}s`);
  element.append(label);
  elements.cloud.append(element);

  const entry = { text, element, label, fontSize, createdAt };
  wordsByText.set(text, entry);
  updateWordCount();
}

async function loadRecentWords() {
  const { data, error } = await supabaseClient
    .from(TABLE_NAME)
    .select("id,texto,cor,created_at")
    .order("created_at", { ascending: false })
    .limit(MAX_WORDS);

  if (error) {
    showToast(`Não foi possível carregar a nuvem: ${error.message}`);
    return;
  }
  data.reverse().forEach(createOrUpdateWord);
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
    growWord(existing);
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
    cor: WORD_COLORS[Math.floor(Math.random() * WORD_COLORS.length)]
  };

  elements.submit.disabled = true;
  try {
    const { data, error } = await supabaseClient
      .from(TABLE_NAME)
      .insert(word)
      .select("id,texto,cor,created_at")
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
