import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { CONFIG } from './config.js';

const execFileAsync = promisify(execFile);

/**
 * Common technical and project words that speech recognition often mishears.
 */
function cleanTranscribedText(text) {
  if (!text) return '';
  let cleaned = text.trim();

  const replacements = [
    [/\bon guitar\b/gi, 'on GitHub'],
    [/\b(?:on\s+)?get\s*hub\b/gi, 'on GitHub'],
    [/\bgit\s+hub\b/gi, 'GitHub'],
    [/\bwise\s+wallets?\b/gi, 'wisewallets'],
    [/\bvoice\s+wallets?\b/gi, 'wisewallets'],
    [/\bvice\s+wallets?\b/gi, 'wisewallets'],
    [/\boctober\s+festival\b/gi, 'rocktoberfest'],
    [/\brock\s+october(?:\s+fest)?\b/gi, 'rocktoberfest'],
    [/\bgo\s+up\s+and\s+addicted\b/gi, 'go up and edit it'],
  ];

  for (const [regex, rep] of replacements) {
    cleaned = cleaned.replace(regex, rep);
  }

  return cleaned.trim();
}

/**
 * Transcribes audio via Groq Whisper API (whisper-large-v3) if GROQ_API_KEY is configured.
 * Very fast (<1s) and accurate.
 */
async function transcribeWithGroq(audioFilePath, groqApiKey) {
  const fileBytes = fs.readFileSync(audioFilePath);
  const fileName = path.basename(audioFilePath);
  const boundary = `----WebKitFormBoundary${Date.now().toString(16)}`;

  const headerParts = [
    `--${boundary}\r\n`,
    `Content-Disposition: form-data; name="model"\r\n\r\n`,
    `whisper-large-v3\r\n`,
    `--${boundary}\r\n`,
    `Content-Disposition: form-data; name="file"; filename="${fileName}"\r\n`,
    `Content-Type: audio/ogg\r\n\r\n`,
  ];

  const footerParts = [`\r\n--${boundary}--\r\n`];
  const payload = Buffer.concat([
    Buffer.from(headerParts.join('')),
    fileBytes,
    Buffer.from(footerParts.join('')),
  ]);

  const response = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${groqApiKey}`,
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
    },
    body: payload,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Groq API error (${response.status}): ${errorText}`);
  }

  const result = await response.json();
  return cleanTranscribedText(result.text || '');
}

/**
 * Transcribes audio locally using ffmpeg + python speech_recognition (Google Web Speech API).
 * Applies audio loudness normalization and multi-pass speech recognition (en-IN, en-US).
 * Requires zero API key configuration and works out of the box.
 */
async function transcribeWithLocalPython(audioFilePath) {
  const tmpWavPath = path.join(
    os.tmpdir(),
    `voice_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.wav`
  );

  try {
    // 1. Convert to 16kHz mono WAV with loudness normalization for crystal-clear STT
    try {
      await execFileAsync('ffmpeg', [
        '-y',
        '-i',
        audioFilePath,
        '-af',
        'loudnorm=I=-16:TP=-1.5:LRA=11',
        '-ar',
        '16000',
        '-ac',
        '1',
        tmpWavPath,
      ]);
    } catch {
      // Fallback: standard conversion without audio filter if loudnorm fails on tiny files
      await execFileAsync('ffmpeg', [
        '-y',
        '-i',
        audioFilePath,
        '-ar',
        '16000',
        '-ac',
        '1',
        tmpWavPath,
      ]);
    }

    const pythonScript = `
import sys
import speech_recognition as sr

wav_path = sys.argv[1]
recognizer = sr.Recognizer()
recognizer.energy_threshold = 300
recognizer.dynamic_energy_threshold = True
recognizer.pause_threshold = 0.8

try:
    with sr.AudioFile(wav_path) as source:
        audio_data = recognizer.record(source)

    recognized_text = ""
    # Multi-pass: Indian English first (user locale & phonetics), then US English, then default
    for lang in ['en-IN', 'en-US', None]:
        try:
            kwargs = {'language': lang} if lang else {}
            res = recognizer.recognize_google(audio_data, **kwargs)
            if res and res.strip():
                recognized_text = res.strip()
                break
        except sr.UnknownValueError:
            continue
        except Exception:
            continue

    if recognized_text:
        print(recognized_text)
    else:
        sys.exit(2)
except sr.UnknownValueError:
    sys.exit(2)
except Exception as e:
    sys.stderr.write(str(e))
    sys.exit(1)
`;

    const { stdout } = await execFileAsync('python3', ['-c', pythonScript, tmpWavPath]);
    return cleanTranscribedText(stdout || '');
  } catch (err) {
    if (err.code === 2) {
      // Speech recognition could not understand audio
      return '';
    }
    throw err;
  } finally {
    try {
      if (fs.existsSync(tmpWavPath)) {
        fs.unlinkSync(tmpWavPath);
      }
    } catch {
      // ignore cleanup errors
    }
  }
}

/**
 * Transcribes an audio file buffer or path to text.
 * Falls back across available engines:
 * 1. Groq Whisper API (if GROQ_API_KEY is in process.env or CONFIG)
 * 2. Local Python + Google Speech Recognition (free, loudness normalized, multi-pass)
 *
 * @param {string} audioFilePath
 * @returns {Promise<string>} Transcribed text or empty string
 */
export async function transcribeAudioFile(audioFilePath) {
  if (!fs.existsSync(audioFilePath)) {
    throw new Error(`Audio file not found: ${audioFilePath}`);
  }

  const groqApiKey = process.env.GROQ_API_KEY || CONFIG.groqApiKey;
  if (groqApiKey) {
    try {
      const text = await transcribeWithGroq(audioFilePath, groqApiKey);
      if (text) return text;
    } catch (err) {
      console.warn('⚠️ Groq transcription failed, falling back to local STT:', err.message);
    }
  }

  // Fallback to local STT
  return await transcribeWithLocalPython(audioFilePath);
}
