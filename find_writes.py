with open(r'C:\Users\janak\.gemini\antigravity\brain\e7245da5-1cd9-47be-9165-e26b4493c01c\.system_generated\logs\transcript_full.jsonl', 'r', encoding='utf-8', errors='ignore') as f:
    for idx, line in enumerate(f):
        if "app.js" in line and ("write_text" in line or "write(" in line or "write_file" in line):
            print(f"Line {idx}")
