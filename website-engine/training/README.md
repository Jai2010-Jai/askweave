# 🧠 Weave Custom Router Training (QLoRA)

This folder contains everything needed to train your custom model:
- `dataset.jsonl`: **930 curated training examples** matching your exact GenZ style, chill tone, zero emojis, and real projects.
- `Weave_QLoRA_Training.ipynb`: Ready-to-run Google Colab notebook (free T4 GPU).
- `generate_dataset.js`: Script used to generate/extend the dataset.
- `train_unsloth.py`: Python training script if running on a local GPU.

---

## 🚀 How to Train in 15 Minutes (Free on Google Colab)

1. Open **[colab.research.google.com](https://colab.research.google.com)**.
2. Click **Upload** $\rightarrow$ select `training/Weave_QLoRA_Training.ipynb`.
3. In Colab, go to **Runtime** $\rightarrow$ **Change runtime type** $\rightarrow$ select **T4 GPU** (Free).
4. In the left panel, upload [`training/dataset.jsonl`](file:///home/tinchu/weave/training/dataset.jsonl).
5. Click **Runtime** $\rightarrow$ **Run all**.

Training takes about **12–15 minutes**. When it completes, the notebook automatically exports and downloads your quantized GGUF model:
`weave-llama3.2-3b-q4.gguf`

---

## ⚡ How to Run Your Model with Weave

Once you download `weave-llama3.2-3b-q4.gguf`:

1. Create a Modelfile:
   ```dockerfile
   FROM ./weave-llama3.2-3b-q4.gguf
   ```
2. Register it with Ollama:
   ```bash
   ollama create weave -f Modelfile
   ```
3. Set your `.env`:
   ```env
   ROUTER_BASE_URL=http://localhost:11434/v1
   ROUTER_API_KEY=ollama
   ROUTER_MODEL=weave
   ```
Weave will immediately use your custom weights for all WhatsApp routing and chit-chat!
