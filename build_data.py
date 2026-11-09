#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Rebuild trainer questions from the OM docx extracts. Do not invent missing text."""
import json
import re
from pathlib import Path

EXTRACT = Path("/tmp/om_full")
DATA = Path("/Users/d.dfeeevv/Desktop/Шпоры аккредитация/тренажер/data.js")

FILES = {
    "ПИС": "_Проектирование_ИС_3_2_.txt",
    "ВСС": "__Вычислительные_системы_сети_и_телекомм.txt",
    "АЛГ": "Б1_О_13_Линеи_ная_и_высшая_алгебра_испр.txt",
    "ТОИ": "__Теоретические_основы_информатикииспр_2.txt",
    "ФИЗ": "Б1_О_16_Физика.txt",
    "ДИФ": "Б1_О_19_Дифференциальные_и_разностные_ур.txt",
    "МАТ": "Б1_О_21_Математическии__анализ_испр.txt",
}
NAMES = {
    "ИСТ": "История России",
    "ОРГ": "Основы российской государственности",
    "ПИС": "Проектирование ИС",
    "ВСС": "Сети и телекоммуникации",
    "АЛГ": "Линейная и высшая алгебра",
    "ТОИ": "Теоретические основы информатики",
    "ФИЗ": "Физика",
    "ДИФ": "Дифуры",
    "МАТ": "Математический анализ",
}
LAT = str.maketrans({"a": "а", "b": "б", "c": "в", "d": "г", "e": "д", "A": "а", "B": "б", "C": "в", "D": "г", "E": "д"})
SKIPPED = []

def clean(s):
    s = re.sub(r"\s+", " ", s or "").strip(" .;:")
    return s

def cyr(ch):
    return ch.lower().translate(LAT)

def hollow(q):
    t = clean(re.sub(r"^\d+[.)]\s*", "", q))
    t = t.replace(" ?", "").replace("?", "").strip(" .")
    pats = [
        r"Найдите\s*,?",
        r"Вычислите",
        r"Чему равен предел( функции)?( при)?( \(радианы\))?",
        r"\(\)\s*Найдите",
        r"Найдите",
    ]
    return any(re.fullmatch(p, t, re.I) for p in pats)

def split_opts(blob):
    """Return (prompt, {letter: text}) for а)/б) including glued options."""
    pat = re.compile(
        r"(?:(?<![A-Za-zА-Яа-яЁё0-9])([а-еa-eA-E])[.)]\.?\s*"
        r"|(?<=[A-Za-zА-Яа-яЁё0-9])([абвгде])[.)]\.?\s*(?=[А-ЯA-Z«(0-9]))"
    )
    ms = list(pat.finditer(blob))
    if not ms:
        return clean(blob), {}
    prompt = clean(blob[: ms[0].start()])
    prompt = re.sub(r"^\d+[.)]\s*", "", prompt)
    opts = {}
    for i, m in enumerate(ms):
        let = cyr(m.group(1) or m.group(2))
        end = ms[i + 1].start() if i + 1 < len(ms) else len(blob)
        opts[let] = clean(blob[m.end() : end])
    return prompt, opts

def answer_kind(ans):
    s = ans.lower().replace("ё", "е").translate(LAT)
    s = s.replace("—", "-").replace("–", "-").replace("−", "-")
    n2l = re.findall(r"(\d+)\s*-\s*([а-е])", s)
    if n2l and not re.search(r"[а-е]\)\s*-", s):
        return "n2l", {int(n): let for n, let in n2l}
    l2n = re.findall(r"([а-е])\)?\s*-\s*(\d+)", s)
    if l2n:
        return "l2n", {let: int(n) for let, n in l2n}
    letters = re.findall(r"[а-е]", s.split("\n")[0])
    one = re.search(r"[а-е]", s)
    return "letters", letters if len(letters) > 1 else (one.group(0) if one else "")

def parse_items(chunk):
    """Line-based numbered and lettered columns. Prompt is the leading text."""
    lines = [ln.strip() for ln in chunk.splitlines() if ln.strip()]
    prompt = []
    nums, lets = {}, {}
    started = False
    for ln in lines:
        mnum = re.match(r"^(\d+)(?:[.)]\s*|\s+)(.+)", ln)
        mlet = re.match(r"^([а-еa-eA-E])[.)]\s*(.+)", ln)
        if mnum and not started and re.search(r"Сопоставьте|Установите|Величины|Расположите", mnum.group(2)):
            prompt.append(mnum.group(2))
            continue
        if mnum and mnum.group(2):
            nums[int(mnum.group(1))] = clean(mnum.group(2))
            started = True
            continue
        if mlet and mlet.group(2):
            lets[cyr(mlet.group(1))] = clean(mlet.group(2))
            started = True
            continue
        if not started:
            prompt.append(ln)
    return clean(" ".join(prompt)), nums, lets

def take_pairs(chunk, ans):
    kind, mapping = answer_kind(ans)
    prompt, nums, lets = parse_items(chunk)
    if kind not in ("n2l", "l2n"):
        return None
    pairs = []
    missing = False
    if kind == "n2l":
        for n in sorted(mapping):
            left, right = nums.get(n, ""), lets.get(mapping[n], "")
            if not left or not right:
                missing = True
                break
            pairs.append([left, right])
    else:
        order = sorted(mapping, key=lambda k: mapping[k])
        for let in order:
            left, right = lets.get(let, ""), nums.get(mapping[let], "")
            if not left or not right:
                missing = True
                break
            pairs.append([left, right])
    if missing or len(pairs) < 2:
        return None
    if not prompt:
        prompt = "Соответствие"
    return prompt, pairs

def section(text, start_pat, end_pat):
    m = re.search(start_pat + r"(.*?)" + end_pat, text, re.S | re.I)
    return m.group(1) if m else ""

def blocks_of(text):
    text = re.split(r"Показатели и критерии", text)[0]
    m = re.search(r"Открытые задания", text)
    if not m:
        return []
    text = text[m.start() :]
    parts = re.split(r"(?=Открытые задания)", text)
    out = []
    for ch in parts:
        if "Открытые" not in ch:
            continue
        op = section(ch, r"Открытые задания:\s*", r"(?=Закрытые задания:|Вопрос множественного|Вопросы множественного)")
        cl = section(ch, r"(?:Закрытые задания:\s*)?(?:Вопрос множественного выбора[^\n]*|Вопросы множественного выбора[^\n]*)\s*", r"(?=Вопросы на установление соответствия)")
        if not cl:
            cl = section(ch, r"Закрытые задания:\s*", r"(?=Вопросы на установление соответствия)")
        mt = section(ch, r"Вопросы на установление соответствия:?\s*", r"(?=Вопросы на последовательность)")
        sq = ""
        sm = re.search(r"Вопросы на последовательность:?\s*(.*)$", ch, re.S)
        if sm:
            sq = sm.group(1)
        out.append((op, cl, mt, sq))
    return out

def parse_open(sec, subj):
    items = []
    parts = re.split(r"Верный ответ\s*:?\s*", sec)
    for i in range(1, len(parts)):
        raw = re.split(r"\n(?=\s*\d+[.)])", parts[i])[0]
        if re.match(r"\s*\d+[.)]\s", raw):
            ans = ""
        else:
            ans = clean(re.split(r"\n(?=[А-ЯA-Z])", raw)[0])
        prev = parts[i - 1]
        prev = re.sub(r"Открытые задания:\s*", "", prev)
        q = clean(prev.strip().split("\n")[-1] if "\n" in prev else prev)
        q = re.sub(r"^\d+[.)]\s*", "", q)
        if not ans:
            SKIPPED.append((subj, "открытый без ответа", q[:80]))
            continue
        if hollow(q) or len(re.findall(r"[A-Za-zА-Яа-яЁё]", q)) < 8:
            SKIPPED.append((subj, "открытый без формулы/условия", q[:80]))
            continue
        items.append({"type": "text", "prompt": q, "answer": ans})
    return items

def parse_closed(sec, subj):
    items = []
    parts = re.split(r"Верный ответ\s*:?\s*", sec)
    for i in range(1, len(parts)):
        ans = parts[i]
        kind, mapping = answer_kind(ans)
        letter = mapping if isinstance(mapping, str) else ""
        prev = parts[i - 1]
        prev = re.sub(r"(Закрытые задания:|Вопрос множественного[^\n]*|Вопросы множественного[^\n]*)", "", prev)
        nums = list(re.finditer(r"(?:^|\n)\s*\d+[.)]\s*", prev))
        chunk = prev[nums[-1].start() :] if nums else prev
        prompt, opts = split_opts(chunk)
        prompt = re.sub(r"^\d+[.)]\s*", "", clean(prompt))
        if not letter or letter not in opts or not opts[letter]:
            SKIPPED.append((subj, "тест без варианта", prompt[:80]))
            continue
        options = [opts[k] for k in "абвгде" if k in opts and opts[k]]
        if opts[letter] not in options:
            SKIPPED.append((subj, "тест, ответ не в вариантах", prompt[:80]))
            continue
        items.append({"type": "mcq", "prompt": prompt, "options": options, "answer": opts[letter]})
    return items

def parse_match(sec, subj):
    items = []
    parts = re.split(r"Верный ответ\s*:?\s*", sec)
    for i in range(1, len(parts)):
        ans = re.split(r"\n(?=\s*\d+[.)]\s)", parts[i])[0]
        prev = parts[i - 1]
        starts = list(re.finditer(r"(?:^|\n)\s*\d+[.)]\s+(?:Сопоставьте|Установите|Величины)", prev))
        if starts:
            prev = prev[starts[-1].start() :]
        got = take_pairs(prev, ans)
        if not got:
            head = clean(prev.strip().split("\n")[0])[:80]
            SKIPPED.append((subj, "соответствие не разобралось", head))
            continue
        prompt, pairs = got
        items.append({"type": "match", "prompt": prompt, "pairs": pairs})
    return items

def parse_seq(sec, subj):
    items = []
    parts = re.split(r"Верный ответ\s*:?\s*", sec)
    for i in range(1, len(parts)):
        ans = re.split(r"\n(?=\s*\d+[.)])", parts[i])[0]
        kind, letters = answer_kind(ans)
        if kind != "letters" or not isinstance(letters, list):
            letters = re.findall(r"[а-е]", ans.lower().translate(LAT))
        prev = parts[i - 1]
        nums = list(re.finditer(r"(?:^|\n)\s*\d+[.)]\s+", prev))
        chunk = prev[nums[-1].start() :] if nums else prev
        prompt, opts = split_opts(chunk)
        prompt = re.sub(r"^\d+[.)]\s*", "", clean(prompt))
        steps = []
        bad = False
        for let in letters:
            if let not in opts or not opts[let]:
                bad = True
                break
            steps.append(opts[let])
        if bad or len(steps) < 3:
            SKIPPED.append((subj, "порядок не разобрался", prompt[:80]))
            continue
        items.append({"type": "order", "prompt": prompt, "steps": steps})
    return items

def parse_file(subj, path):
    text = path.read_text(encoding="utf-8")
    items = []
    for op, cl, mt, sq in blocks_of(text):
        items += parse_open(op, subj)
        items += parse_closed(cl, subj)
        items += parse_match(mt, subj)
        items += parse_seq(sq, subj)
    for it in items:
        it["subject"] = subj
    return items

# Formulas are Equation Editor objects, not document text. Taken from the
# TeX stored inside those objects, plus the physics values visible in Word.
EXTRA = {
    "АЛГ": [
        {"type": "text", "prompt": "Найдите rank A, где A — матрица со строками (1, 2, 0, 3), (0, 1, 2, 4), (0, 0, 1, 5).", "answer": "3"},
        {"type": "text", "prompt": "Найдите rank A, где A — матрица со строками (1, 2, 0, 1), (0, 1, 3, 4), (1, 3, 3, 5).", "answer": "2"},
        {"type": "text", "prompt": "Найдите rank A, где A — матрица со строками (2, 4, 6, 8), (1, 2, 3, 4), (−1, −2, −3, −4).", "answer": "1"},
    ],
    "МАТ": [
        {"type": "text", "prompt": "Чему равен предел функции f(x) = 3x − 1 при x → 2?", "answer": "5"},
        {"type": "text", "prompt": "Чему равен предел x² при x → −1?", "answer": "1"},
        {"type": "text", "prompt": "Чему равен предел функции sin(x) / x при x → 0 (радианы)?", "answer": "1"},
        {"type": "text", "prompt": "Чему равен предел функции (1 − cos x) / x при x → 0 (радианы)?", "answer": "0"},
        {"type": "text", "prompt": "f(x) = ln(3x), x > 0. Найдите f′(1).", "answer": "1"},
        {"type": "text", "prompt": "f(x) = e^(2x). Найдите f′(0).", "answer": "2"},
        {"type": "text", "prompt": "f(x) = sin x. Найдите f′(0).", "answer": "1"},
        {"type": "text", "prompt": "f(x) = cos x. Найдите f′(0).", "answer": "0"},
        {"type": "text", "prompt": "Вычислите интеграл от 1 до 3 функции 2x dx.", "answer": "8"},
        {"type": "text", "prompt": "Вычислите интеграл от 0 до 1 функции (2x + 3) dx.", "answer": "4"},
    ],
    "ФИЗ": [
        {"type": "text", "prompt": "Тело движется равномерно со скоростью v = 5 м/с в течение t = 4 с. Найти путь S.", "answer": "20 м"},
        {"type": "text", "prompt": "Сопротивление проводника R = 10 Ом, напряжение U = 20 В. Найти силу тока I.", "answer": "2 А"},
        {"type": "text", "prompt": "Период гармонических колебаний T = 0,5 с. Найти частоту f.", "answer": "2 Гц"},
        {"type": "text", "prompt": "Газ совершил работу A = 200 Дж и получил количество теплоты Q = 500 Дж. Найти изменение внутренней энергии ΔU (Q = ΔU + A).", "answer": "300 Дж"},
    ],
}

def main():
    raw = DATA.read_text(encoding="utf-8")
    old = json.loads(raw[raw.find("{") :].rstrip().rstrip(";"))
    kept = [q for q in old["questions"] if q["subject"] in ("ИСТ", "ОРГ")]
    fresh = []
    for sid, name in FILES.items():
        got = EXTRA.get(sid, []) + parse_file(sid, EXTRACT / name)
        for it in got:
            it.setdefault("subject", sid)
            if it["prompt"].startswith("При уменьшении периода колебаний частота"):
                it["prompt"] = "При уменьшении периода колебаний частота ν = 1/T увеличивается или уменьшается?"
            elif it["prompt"].startswith("В формуле") and "сопротивлени" in it["prompt"]:
                it["prompt"] = "В формуле I = U/R при росте сопротивления R ток I увеличивается или уменьшается?"
        fresh += got
        print(sid, len(got), {t: sum(1 for q in got if q["type"] == t) for t in ("text", "mcq", "match", "order")})
    items = kept + fresh
    # re-id everything so old attempts don't point at a different question
    counts = {}
    for it in items:
        counts[it["subject"]] = counts.get(it["subject"], 0) + 1
        it["id"] = f"{it['subject']}-{counts[it['subject']]}"
        it.pop("block", None)
    subjects = []
    for sid in ["ИСТ", "ОРГ", "ПИС", "ВСС", "АЛГ", "ТОИ", "ФИЗ", "ДИФ", "МАТ"]:
        n = sum(1 for q in items if q["subject"] == sid)
        if n:
            subjects.append({"id": sid, "name": NAMES[sid], "count": n})
    DATA.write_text("window.BANK = " + json.dumps({"subjects": subjects, "questions": items}, ensure_ascii=False, indent=2) + ";\n", encoding="utf-8")
    print("TOTAL", len(items), "kept", len(kept))
    print("SKIPPED", len(SKIPPED))
    for row in SKIPPED:
        print(" -", " | ".join(row))

if __name__ == "__main__":
    main()
