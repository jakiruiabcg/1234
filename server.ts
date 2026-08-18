import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = 3000;

// Middleware for parsing JSON with large payload for passport images
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));

// Initialize Gemini client lazily/safely
let genAI: GoogleGenAI | null = null;
function getGeminiClient(): GoogleGenAI | null {
  if (!genAI && process.env.GEMINI_API_KEY) {
    genAI = new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });
  }
  return genAI;
}

// Health check endpoint
app.get("/api/health", (_req, res) => {
  res.json({
    status: "ok",
    hasGeminiKey: Boolean(process.env.GEMINI_API_KEY),
    timestamp: new Date().toISOString(),
  });
});

// AI Passport Scanner Endpoint
app.post("/api/scan-passport", async (req, res) => {
  try {
    const { imageBase64, mimeType = "image/jpeg" } = req.body;

    if (!imageBase64) {
      return res.status(400).json({ error: "No image data provided" });
    }

    const ai = getGeminiClient();
    if (!ai) {
      return res.status(503).json({
        error: "GEMINI_API_KEY is not configured",
        useClientFallback: true,
      });
    }

    // Clean base64 string if it contains data URI prefix
    const cleanBase64 = imageBase64.replace(/^data:image\/[a-z]+;base64,/, "");

    const prompt = `You are an expert OCR & passport document analyst specializing in Bangladeshi (E-Passport, MRP) and International passports.
Analyze this passport image and extract all standard details accurately.
- Extract the Full Name (Given Name + Surname).
- Extract the Father's Name and Mother's Name (if visible).
- Extract the Passport Number (e.g. A01234567, EE0123456, etc.).
- Extract Date of Birth (YYYY-MM-DD), Date of Issue (YYYY-MM-DD), Date of Expiry (YYYY-MM-DD).
- Extract Nationality (e.g. BANGLADESHI / BGD / etc.).
- Extract Sex/Gender (Male/Female/Other).
- Extract Place of Birth / Place of Issue.
- Extract the MRZ (Machine Readable Zone) lines if visible at the bottom.
Format dates strictly as YYYY-MM-DD if recognizable.
If any field is not clearly readable or missing, return empty string "".`;

    const response = await ai.models.generateContent({
      model: "gemini-3.7-flash",
      contents: {
        parts: [
          {
            inlineData: {
              mimeType: mimeType,
              data: cleanBase64,
            },
          },
          {
            text: prompt,
          },
        ],
      },
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            fullName: {
              type: Type.STRING,
              description: "Full name of the passport holder in English or transliterated",
            },
            fatherName: {
              type: Type.STRING,
              description: "Father's name of the passport holder",
            },
            motherName: {
              type: Type.STRING,
              description: "Mother's name of the passport holder (if present)",
            },
            spouseName: {
              type: Type.STRING,
              description: "Spouse's name (if present)",
            },
            passportNo: {
              type: Type.STRING,
              description: "Official Passport Number (e.g., A01234567, BG1234567)",
            },
            nationality: {
              type: Type.STRING,
              description: "Nationality e.g., BANGLADESHI",
            },
            dateOfBirth: {
              type: Type.STRING,
              description: "Date of Birth formatted as YYYY-MM-DD",
            },
            gender: {
              type: Type.STRING,
              description: "Gender: Male / Female / Other",
            },
            placeOfBirth: {
              type: Type.STRING,
              description: "Place of birth or issue city",
            },
            issueDate: {
              type: Type.STRING,
              description: "Date of Issue formatted as YYYY-MM-DD",
            },
            expiryDate: {
              type: Type.STRING,
              description: "Date of Expiry formatted as YYYY-MM-DD",
            },
            mrzLines: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
              description: "MRZ 2-line or 3-line codes at bottom of passport",
            },
            confidence: {
              type: Type.STRING,
              description: "Confidence level: High / Medium / Low",
            },
          },
          required: ["fullName", "passportNo"],
        },
      },
    });

    const parsedData = JSON.parse(response.text || "{}");
    return res.json({
      success: true,
      data: parsedData,
      source: "gemini-ai",
    });
  } catch (error: any) {
    console.error("Gemini Passport OCR error:", error);
    return res.status(500).json({
      error: error.message || "Failed to scan passport with AI",
      useClientFallback: true,
    });
  }
});

// Vite middleware setup
async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (_req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Passport System Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
