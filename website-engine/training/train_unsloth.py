"""
Weave QLoRA Fine-Tuning Script
Base Model: unsloth/Llama-3.2-3B-Instruct (or unsloth/Qwen2.5-3B-Instruct)
Runs on free Google Colab (T4 GPU) or any 8GB+ GPU.
Trains in ~10-15 minutes and exports to GGUF format for Ollama.
"""

import os
import torch
from unsloth import FastLanguageModel
from datasets import load_dataset
from trl import SFTTrainer
from transformers import TrainingArguments

max_seq_length = 1024
dtype = None # Auto detection
load_in_4bit = True

# 1. Load Model & Tokenizer in 4-bit precision (zero VRAM overhead)
print("Loading base model...")
model, tokenizer = FastLanguageModel.from_pretrained(
    model_name="unsloth/Llama-3.2-3B-Instruct",
    max_seq_length=max_seq_length,
    dtype=dtype,
    load_in_4bit=load_in_4bit,
)

# 2. Add LoRA Adapters
model = FastLanguageModel.get_peft_model(
    model,
    r=16,
    target_modules=["q_proj", "k_proj", "v_proj", "o_proj", "gate_proj", "up_proj", "down_proj"],
    lora_alpha=32,
    lora_dropout=0,
    bias="none",
    use_gradient_checkpointing="unsloth",
    random_state=3407,
)

# 3. Load & Format Dataset
print("Loading dataset...")
dataset = load_dataset("json", data_files="dataset.jsonl", split="train")

def formatting_prompts_func(examples):
    convos = examples["messages"]
    texts = [tokenizer.apply_chat_template(convo, tokenize=False, add_generation_prompt=False) for convo in convos]
    return {"text": texts}

dataset = dataset.map(formatting_prompts_func, batched=True)

# 4. Train with SFTTrainer
print("Starting training...")
trainer = SFTTrainer(
    model=model,
    tokenizer=tokenizer,
    train_dataset=dataset,
    dataset_text_field="text",
    max_seq_length=max_seq_length,
    dataset_num_proc=2,
    packing=False,
    args=TrainingArguments(
        per_device_train_batch_size=2,
        gradient_accumulation_steps=4,
        warmup_steps=10,
        max_steps=120, # ~2 epochs on 930 examples
        learning_rate=2e-4,
        fp16=not torch.cuda.is_bf16_supported(),
        bf16=torch.cuda.is_bf16_supported(),
        logging_steps=10,
        optim="adamw_8bit",
        weight_decay=0.01,
        lr_scheduler_type="linear",
        seed=3407,
        output_dir="outputs",
        report_to="none"
    ),
)

trainer_stats = trainer.train()

# 5. Export directly to GGUF format for Ollama / llama.cpp
print("Exporting model to GGUF (q4_k_m)...")
model.save_pretrained_gguf("weave-llama3.2-3b-q4", tokenizer, quantization_method="q4_k_m")
print("Done! You can now run `ollama create weave -f Modelfile` with the exported GGUF!")
