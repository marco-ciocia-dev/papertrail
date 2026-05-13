import convert from "heic-convert";

export const config = {
  api: { bodyParser: { sizeLimit: "20mb" } },
};

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    let body = req.body;
    if (typeof body === "string") {
      try { body = JSON.parse(body); } catch {}
    }

    const { heicBase64 } = body;
    if (!heicBase64) return res.status(400).json({ error: "heicBase64 mancante" });

    const inputBuffer = Buffer.from(heicBase64, "base64");
    const outputBuffer = await convert({ buffer: inputBuffer, format: "JPEG", quality: 0.85 });
    const jpegBase64 = Buffer.from(outputBuffer).toString("base64");

    return res.status(200).json({ jpegBase64 });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
