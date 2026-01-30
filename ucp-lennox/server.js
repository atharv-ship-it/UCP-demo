import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import OpenAI from "openai";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static("public"));

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Lennox AC Products with accurate data from official specs
const PRODUCTS = [
  {
    id: "sl28xcv",
    name: "Lennox SL28XCV",
    series: "Dave Lennox Signature Collection",
    description: "Precise, highest-efficiency, fully digital, variable-capacity air conditioner",
    seer: 28,
    seer2: null,
    noise: 59,
    rating: 4.5,
    reviews: 550,
    price: "$$$$",
    priceDollars: "$12,000",
    energyStar: true,
    image: "/assets/sl28xcv.png",
    features: ["Variable-capacity", "Fully digital", "Ultra-quiet operation", "Premium efficiency"]
  },
  {
    id: "sl25kcv",
    name: "Lennox SL25KCV",
    series: "Dave Lennox Signature Collection",
    description: "The most precise and efficient air conditioner available",
    seer: null,
    seer2: 26,
    noise: 58,
    rating: 4.2,
    reviews: 107,
    price: "$$$$",
    priceDollars: "$10,700",
    energyStar: true,
    image: "/assets/sl25kcv.png",
    features: ["Variable-capacity", "2025 Compliant Refrigerant", "Ultra-quiet", "Top-tier efficiency"]
  },
  {
    id: "xc21",
    name: "Lennox XC21",
    series: "Dave Lennox Signature Collection",
    description: "The most efficient two-stage central air conditioner you can buy",
    seer: 21,
    seer2: 19.2,
    noise: 69,
    rating: 4.5,
    reviews: 1149,
    price: "$$$",
    priceDollars: "$7,700",
    energyStar: true,
    availability: "Regional",
    image: "/assets/xc21.png",
    features: ["Two-stage cooling", "High efficiency", "Reliable performance"]
  },
  {
    id: "el23xcv",
    name: "Lennox EL23XCV",
    series: "Elite Series",
    description: "High-efficiency, digitally-enabled, variable-capacity air conditioner",
    seer: 22,
    seer2: 22.4,
    noise: 59,
    rating: 4.4,
    reviews: 347,
    price: "$$$",
    priceDollars: "$6,300",
    energyStar: true,
    image: "/assets/el23xcv.png",
    features: ["Variable-capacity", "Digital control", "Quiet operation"]
  },
  {
    id: "el22kcv",
    name: "Lennox EL22KCV",
    series: "Elite Series",
    description: "High-efficiency, digital-ready, variable-capacity air conditioner compatible with 2025 Compliant Refrigerant",
    seer: null,
    seer2: 22.5,
    noise: 60,
    rating: 4.6,
    reviews: 224,
    price: "$$$",
    priceDollars: "$6489",
    energyStar: true,
    image: "/assets/el22kcv.png",
    features: ["Variable-capacity", "2025 Compliant Refrigerant", "Digital-ready"]
  },
  {
    id: "el17xc1",
    name: "Lennox EL17XC1",
    series: "Elite Series",
    description: "Mid-efficiency, single-stage air conditioner",
    seer: 18.6,
    seer2: 17.4,
    noise: null,
    rating: 4.5,
    reviews: 1395,
    price: "$$",
    priceDollars: "$5,100",
    energyStar: true,
    image: "/assets/el17xc1.png",
    features: ["Single-stage", "Good efficiency", "Reliable"]
  },
  {
    id: "el16xc1",
    name: "Lennox EL16XC1",
    series: "Elite Series",
    description: "Standard-efficiency, single-stage air conditioner",
    seer: 17,
    seer2: null,
    noise: 71,
    rating: 4.5,
    reviews: 11587,
    price: "$$",
    priceDollars: "$5,500",
    energyStar: true,
    image: "/assets/el16xc1.png",
    features: ["Single-stage", "Proven reliability", "Most popular"]
  },
  {
    id: "el16kc1",
    name: "Lennox EL16KC1",
    series: "Elite Series",
    description: "Mid-efficiency, single-stage air conditioner compatible with 2025 Compliant Refrigerant",
    seer: null,
    seer2: 17,
    noise: 72,
    rating: 4.5,
    reviews: 612,
    price: "$$",
    priceDollars: "$4,000",
    energyStar: true,
    image: "/assets/el16kc1.png",
    features: ["Single-stage", "2025 Compliant Refrigerant", "Energy Star"]
  },
  {
    id: "ml17xc1",
    name: "Lennox ML17XC1",
    series: "Merit Series",
    description: "Standard-efficiency, single-stage air conditioner",
    seer: 17,
    seer2: 16.2,
    noise: null,
    rating: 4.4,
    reviews: 7164,
    price: "$",
    priceDollars: "$2,800",
    energyStar: false,
    image: "/assets/ml17xc1.png",
    features: ["Budget-friendly", "Reliable", "Single-stage"]
  },
  {
    id: "ml17kc2",
    name: "Lennox ML17KC2",
    series: "Merit Series",
    description: "Mid-efficiency, two-stage air conditioner compatible with 2025 Compliant Refrigerant",
    seer: null,
    seer2: 18,
    noise: null,
    rating: 4.4,
    reviews: 373,
    price: "$",
    priceDollars: "$3,500",
    energyStar: true,
    image: "/assets/ml17kc2.png",
    features: ["Two-stage", "2025 Compliant Refrigerant", "Value option"]
  }
];

const SYSTEM_PROMPT = `You are an expert sales assistant for Lennox air conditioning systems. Your goal is to help users find and purchase the best Lennox AC unit for their needs based on their preferences and budget.

RESPONSE STYLE:
- Keep responses SHORT and conversational (1-2 sentences max for questions)
- Never introduce yourself or explain what you do
- Never say things like "I'm here to help you find the perfect..."
- Just ask direct, friendly questions
- Be natural, like texting a knowledgeable friend

YOUR ROLE & SCOPE:
- If request is outside this scope (used units, unrealistic budget, other brands), politely stir the conversation back on track
- Stay focused on your expertise - don't engage with out-of-scope requests beyond one polite redirect

CONVERSATION FLOW:
1. When user asks vague/general questions: Guide them to clarify their needs by asking appropriate questions, not vague suggestions.
2. When user wants to buy/needs an AC: Ask about budget in a simple way
3. Gather info naturally - don't ask too many questions at once
4. Once you understand user purchase intent, nudge them to complete thier purchase by showing the purchase_link.
5. Recommend products only when you have enough context
6. Compare products only when user specifically asks for it

STAGES:
- "exploration": Gathering user needs
- "clarification": Need more specific info
- "recommendation": Ready to show products
- "comparison": Comparing products
- "details": Explaining a specific product

RULES:
- Keep responses concise and natural
- Don't be overly formal or salesy
- Ask ONE question at a time when clarifying
- Recommend 2-4 products max
- Use product IDs exactly as provided

AVAILABLE PRODUCTS:
${PRODUCTS.map(p => `- ${p.id}: ${p.name} (${p.series})
  SEER: ${p.seer || 'N/A'}, SEER2: ${p.seer2 || 'N/A'}, Noise: ${p.noise || 'N/A'}dB
  Price: ${p.price} (${p.priceDollars}), Rating: ${p.rating}/5, Reviews: (${p.reviews} reviews),
  Description: ${p.description}`).join("\n")}

PRODUCT INTELLIGENCE:
When users mention needs, think through which features matter:
- Noise concerns → Lower dB (59-60) = variable-capacity models
- Energy costs → Higher SEER/SEER2 (22+) = long-term savings
- Budget-conscious → Merit Series, single-stage = $2,800-$4,500
- Premium quality → Signature Collection = $10,000-$13,000
- Reliability → High review counts = proven track record

Match products to their stated needs, explain the connection briefly in your response.

Respond ONLY with valid JSON in this exact format:
{
  "stage": "greeting|exploration|clarification|recommendation|comparison|details",
  "response_text": "Your conversational response to the user",
  "recommended_products": ["product_id1", "product_id2"],
  "show_products": false,
  "purchase_link": null
}

CRITICAL: Only recommend products that exist in the AVAILABLE PRODUCTS list. Only state specifications that are explicitly shown in the product data.

Set show_products to true only when necessary to show the product.`;

app.post("/api/chat", async (req, res) => {
  try {
    const { message, history = [] } = req.body;

    const messages = [
      { role: "system", content: SYSTEM_PROMPT },
      ...history,
      { role: "user", content: message }
    ];

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages,
      temperature: 0.4,
      max_tokens: 350,
      response_format: { type: "json_object" }
    });

    const data = JSON.parse(completion.choices[0].message.content);

    const products = data.show_products && data.recommended_products
      ? PRODUCTS.filter(p => data.recommended_products.includes(p.id))
      : [];

    res.json({
      stage: data.stage,
      response_text: data.response_text,
      products,
      purchase_link: data.purchase_link || null
    });
  } catch (error) {
    console.error("Error:", error);
    res.status(500).json({
      error: "Failed to process request",
      response_text: "I'm sorry, I encountered an error. Please try again."
    });
  }
});

// Get all products endpoint
app.get("/api/products", (req, res) => {
  res.json(PRODUCTS);
});

// Get single product endpoint
app.get("/api/products/:id", (req, res) => {
  const product = PRODUCTS.find(p => p.id === req.params.id);
  if (product) {
    res.json(product);
  } else {
    res.status(404).json({ error: "Product not found" });
  }
});

app.listen(PORT, () => {
  console.log(`✅ Lennox AC Assistant running at http://localhost:${PORT}`);
});
