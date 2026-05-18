import { exec } from "child_process";
import cors from "cors";
import dotenv from "dotenv";
import voice from "elevenlabs-node";
import express from "express";
import { promises as fs } from "fs";
dotenv.config();

const DIGIIASK_BASE = "https://digiiask.digii.co.id/api";
const DIGIIASK_HEADERS = {
  Accept: "application/json",
  "Content-Type": "application/json",
  "x-client-id": "0f6ee60a-93cc-494b-9152-2bf44f5fa29d",
  "x-client-secret": "f41e5f9d-1751-4dad-af5f-9503ab4c8224",
};

const elevenLabsApiKey = process.env.ELEVEN_LABS_API_KEY || "sk_a4cb2052289f8ea6b5cb6674f23cedfc6cea99c12313cea0";
const voiceID = "EXAVITQu4vr4xnSDxMaL";

let digiiToken = null;
let digiiTokenExpiry = null;
let sessionId = null;

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

async function chatWithDigii(message) {
  const token = await getDigiiToken();
  const res = await fetch(`${DIGIIASK_BASE}/agent-ai-adk`, {
    method: "POST",
    headers: {
      ...DIGIIASK_HEADERS,
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ text: message, "session id": sessionId }),
  });

  if (res.status === 401) {
    digiiToken = null;
    return chatWithDigii(message);
  }

  const data = await res.json();
  if (data.session_id) sessionId = data.session_id;
  return data.response || data.text || data.message || "";
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
  const charDuration = 0.08;
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

    const duration = vowelMap[ch] ? 0.12 : charDuration;
    cues.push({ start: time, end: time + duration, value });
    time += duration;
  }

  return { mouthCues: cues };
}

const app = express();
app.use(express.json());
app.use(cors());
const port = 3005;

app.get("/", (req, res) => {
  res.send("Virtual Assistant Backend Running");
});

app.get("/voices", async (req, res) => {
  res.send(await voice.getVoices(elevenLabsApiKey));
});

const execCommand = (command) => {
  return new Promise((resolve, reject) => {
    exec(command, (error, stdout, stderr) => {
      if (error) reject(error);
      resolve(stdout);
    });
  });
};

const lipSyncMessage = async (index, text) => {
  try {
    await execCommand(
      `ffmpeg -y -i audios/message_${index}.mp3 audios/message_${index}.wav`
    );
    await execCommand(
      `./bin/rhubarb -f json -o audios/message_${index}.json audios/message_${index}.wav -r phonetic`
    );
  } catch (e) {
    const fallback = generateMouthCues(text);
    await fs.writeFile(
      `audios/message_${index}.json`,
      JSON.stringify(fallback)
    );
  }
};

app.post("/chat", async (req, res) => {
  const userMessage = req.body.message;

  if (!userMessage) {
    const introText = "Halo! Saya Virtual Assistant. Ada yang bisa saya bantu?";
    const introLipsync = generateMouthCues(introText);
    res.send({
      messages: [
        {
          text: introText,
          facialExpression: "smile",
          animation: "Talking_1",
          lipsync: introLipsync,
        },
      ],
    });
    return;
  }

  try {
    const aiResponse = await chatWithDigii(userMessage);

    const messages = [
      {
        text: aiResponse,
        facialExpression: "default",
        animation: "Talking_0",
      },
    ];

    for (let i = 0; i < messages.length; i++) {
      const message = messages[i];
      const fileName = `audios/message_${i}.mp3`;
      await voice.textToSpeech(elevenLabsApiKey, voiceID, fileName, message.text);
      await lipSyncMessage(i, message.text);
      message.audio = await audioFileToBase64(fileName);
      message.lipsync = await readJsonTranscript(`audios/message_${i}.json`);
    }

    res.send({ messages });
  } catch (error) {
    console.error("Error:", error.message);
    res.status(500).send({ error: error.message });
  }
});

const readJsonTranscript = async (file) => {
  const data = await fs.readFile(file, "utf8");
  return JSON.parse(data);
};

const audioFileToBase64 = async (file) => {
  const data = await fs.readFile(file);
  return data.toString("base64");
};

app.listen(port, () => {
  console.log(`Virtual Assistant listening on port ${port}`);
});
