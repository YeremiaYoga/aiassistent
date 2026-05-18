const DIGIIASK_BASE = "https://digiiask.digii.co.id/api";
const DIGIIASK_HEADERS = {
  Accept: "application/json",
  "Content-Type": "application/json",
  "x-client-id": "0f6ee60a-93cc-494b-9152-2bf44f5fa29d",
  "x-client-secret": "f41e5f9d-1751-4dad-af5f-9503ab4c8224",
};

const ELEVENLABS_API_KEY = "sk_a4cb2052289f8ea6b5cb6674f23cedfc6cea99c12313cea0";
const ELEVENLABS_VOICE_ID = "EXAVITQu4vr4xnSDxMaL";

let digiiToken = null;
let digiiTokenExpiry = null;

async function getDigiiToken() {
  if (digiiToken && digiiTokenExpiry && Date.now() < digiiTokenExpiry) {
    return digiiToken;
  }
  const res = await fetch(`${DIGIIASK_BASE}/get-token`, {
    method: "POST",
    headers: DIGIIASK_HEADERS,
    body: JSON.stringify({ email: "sdigii@gmail.com", password: "12345" }),
  });
  const data = await res.json();
  digiiToken = data.access_token;
  digiiTokenExpiry = Date.now() + 50 * 60 * 1000;
  return digiiToken;
}

async function chatWithDigii(message, sessionId) {
  const token = await getDigiiToken();
  const res = await fetch(`${DIGIIASK_BASE}/agent-ai-adk`, {
    method: "POST",
    headers: {
      ...DIGIIASK_HEADERS,
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ text: message, "session id": sessionId || null }),
  });

  if (res.status === 401) {
    digiiToken = null;
    return chatWithDigii(message, sessionId);
  }

  const data = await res.json();
  return data;
}

async function generateTTS(text) {
  const res = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${ELEVENLABS_VOICE_ID}`,
    {
      method: "POST",
      headers: {
        Accept: "audio/mpeg",
        "Content-Type": "application/json",
        "xi-api-key": ELEVENLABS_API_KEY,
      },
      body: JSON.stringify({
        text: text,
        model_id: "eleven_multilingual_v2",
        voice_settings: {
          stability: 0.4,
          similarity_boost: 0.8,
          style: 0.15,
          use_speaker_boost: true,
        },
      }),
    }
  );

  if (!res.ok) return null;

  const buffer = await res.arrayBuffer();
  return Buffer.from(buffer).toString("base64");
}

function generateMouthCues(text) {
  const vowelMap = { a: "D", e: "C", i: "C", o: "E", u: "F" };
  const consonantMap = {
    b: "A", p: "A", m: "A",
    f: "G", v: "G",
    t: "B", d: "B", n: "B", l: "B", s: "B", z: "B",
    k: "B", g: "B",
    r: "B", h: "B",
    w: "F", y: "C",
  };

  const cues = [];
  const chars = text.toLowerCase().replace(/[^a-z\s.,!?]/g, "").split("");
  let time = 0;

  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];

    if (ch === " " || /[.,!?]/.test(ch)) {
      const pause = /[.!?]/.test(ch) ? 0.3 : 0.12;
      cues.push({ start: time, end: time + pause, value: "X" });
      time += pause;
      continue;
    }

    let value = "X";
    if (vowelMap[ch]) {
      value = vowelMap[ch];
    } else if (consonantMap[ch]) {
      value = consonantMap[ch];
    }

    const duration = vowelMap[ch] ? 0.12 : 0.08;
    cues.push({ start: time, end: time + duration, value });
    time += duration;
  }

  return { mouthCues: cues };
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { message, sessionId } = req.body || {};

  if (!message) {
    const introText = "Halo! Saya Virtual Assistant. Ada yang bisa saya bantu?";
    return res.json({
      messages: [
        {
          text: introText,
          facialExpression: "smile",
          animation: "Talking_1",
          audio: null,
          lipsync: generateMouthCues(introText),
        },
      ],
    });
  }

  try {
    const aiData = await chatWithDigii(message, sessionId);
    const aiText = aiData.response || aiData.text || aiData.message || "";
    const newSessionId = aiData.session_id || null;

    const audio = await generateTTS(aiText);
    const lipsync = generateMouthCues(aiText);

    return res.json({
      messages: [
        {
          text: aiText,
          facialExpression: "default",
          animation: "Talking_0",
          audio: audio,
          lipsync: lipsync,
        },
      ],
      sessionId: newSessionId,
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
