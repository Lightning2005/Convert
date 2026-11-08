#!/usr/bin/env python3
"""Проверка на попавшие в репозиторий доступы.

Запускается из .githooks/pre-commit (staged-строки) и из CI (--all, все
отслеживаемые файлы). Выводит только имя файла, номер строки и маску
нарушения — сами значения в лог не попадают.

    python scripts/check_secrets.py --all
    python scripts/check_secrets.py --staged
"""

import argparse
import os
import re
import subprocess
import sys

# Имена, под которыми доступы к хостингу и ключи уже лежали в этом проекте.
FORBIDDEN_NAMES = re.compile(
    r"(^|/)(ftp\.txt|ftp\.cfg|curl-ftp\.cfg|creds(\.netrc)?|[^/]*\.netrc|"
    r"id_rsa|id_ed25519|[^/]*\.pem|\.env)$",
    re.IGNORECASE,
)
# .env.example — шаблон с плейсхолдерами, его разрешаем.
ALLOWED_NAMES = re.compile(r"\.env\.example$", re.IGNORECASE)
# Сам детектор содержит слова password/secret в регулярках — проверять его бессмысленно.
SELF = "scripts/check_secrets.py"

# Ключ=значение, где значение похоже на настоящий пароль. Ключ может быть с
# префиксом и суффиксом (FTP_PASSWORD, passwd_plain, secret_key), поэтому границы
# слова не требуем: \b после подчёркивания не существует.
KEYWORD = r"(?:password|passwd|pwd|secret|api[_-]?key|access[_-]?key|auth[_-]?token|private[_-]?key|client[_-]?secret)"
ASSIGNMENT = re.compile(
    r"(?i)(?:^|[^\w.-])(?P<key>[\w.-]*" + KEYWORD + r"[\w.-]*)\s*[:=]\s*[\"']?(?P<val>[^\s\"']{6,})"
)
# Атрибут в HTML/XML и параметр в URL тоже ловим: password="..."
ASSIGNMENT_HTML = re.compile(
    r"(?i)\b(password|passwd|secret|token)\s*=\s*[\"'](?P<val>[^\"']{6,})[\"']"
)
# scheme://login:password@host
URL_CREDENTIALS = re.compile(r"(?i)\b[a-z][a-z0-9+.-]*://[^\s/:@]+:(?P<val>[^\s/@]+)@")
# <input type="password" value="настоящий пароль">: ключевое слово и значение разнесены
HTML_VALUE_ON_PASSWORD_LINE = re.compile(
    r"(?i)^(?=.*password).*\bvalue\s*=\s*[\"'](?P<val>[^\"']{8,})[\"']"
)
# Логин хостинга reg.ru рядом с паролем: u3715740:<что-то>
HOSTING_PAIR = re.compile(r"\bu\d{6,8}:(?P<val>[^\s\"']{6,})")

# Значения, которые заведомо не секрет: переменные окружения, плейсхолдеры,
# подстановки CI, пустые строки, слова из документации.
PLACEHOLDER = re.compile(
    r"(?i)^("
    r".*(getenv|environ|config\(|settings\.|os\.env|process\.env|argv).*|"
    r"\$\{[^}]*\}?|\$[a-z_][a-z0-9_]*|%[a-z_][a-z0-9_]*%|"
    r"\{\{[^}]*\}\}|<[^>]*>|\.\.\.+|xxx+|yyy+|zzz+|"
    r"changeme|change_me|your[_-]?\w*|my[_-]?\w*|example\w*|sample\w*|placeholder|"
    r"django-insecure-.*|"          # штатный ключ Django для локальной разработки
    r"password|passwd|secret|token|none|null|nil|true|false|empty|dummy|test\w*|"
    r"dev\w*|local\w*|default|admin123?|123456?|qwerty|"
    r"\*{3,}|-{3,}|_{3,}"
    r")$"
)
# Строковые литералы меньше этого длины почти всегда слова из кода, а не пароли.
MIN_SUSPICIOUS_LEN = 8


def masked(value):
    """Показываем длину и первый символ, чтобы нарушение можно было найти."""
    if len(value) <= 2:
        return "**"
    return value[0] + "*" * (len(value) - 1)


def suspicious(value):
    if len(value) < MIN_SUSPICIOUS_LEN:
        return False
    if PLACEHOLDER.match(value):
        return False
    # Паролем не бывает слово из одного строчного словарного куска без цифр и символов
    if value.isalpha() and value.islower() and len(value) < 12:
        return False
    return True


def check_lines(source, lines):
    """Возвращает список нарушений для набора строк (файл, строка, правило, значение)."""
    found = []
    for lineno, line in lines:
        for rule, rx in (("присваивание", ASSIGNMENT), ("атрибут", ASSIGNMENT_HTML),
                         ("значение в форме", HTML_VALUE_ON_PASSWORD_LINE),
                         ("доступ в URL", URL_CREDENTIALS), ("логин:пароль", HOSTING_PAIR)):
            for m in rx.finditer(line):
                val = m.groupdict().get("val") or m.group(0)
                key = m.groupdict().get("key")
                val = val.rstrip("'\",;)")
                if suspicious(val):
                    label = "%s (%s)" % (rule, key) if key else rule
                    found.append((source, lineno, label, val))
    return found


def staged_lines():
    """Только добавленные строки из индекса, с реальными номерами строк в файле."""
    out = subprocess.run(["git", "diff", "--cached", "-U0", "--no-color"],
                         capture_output=True).stdout.decode("utf-8", "replace")
    result = []
    path = None
    new_lineno = 0
    for raw in out.splitlines():
        if raw.startswith("+++ "):
            name = raw[4:].strip()
            path = name[2:] if name.startswith("b/") else None
        elif raw.startswith("@@"):
            m = re.search(r"\+(\d+)(?:,(\d+))?", raw)
            new_lineno = int(m.group(1)) if m else 0
        elif raw.startswith("+") and not raw.startswith("+++"):
            if path:
                result.append((path, [(new_lineno, raw[1:])]))
            new_lineno += 1
        elif not raw.startswith("-"):
            new_lineno += 1
    return result


def tracked_files():
    listing = subprocess.run(["git", "ls-files", "-z"], capture_output=True).stdout.decode().split("\0")
    for rel in listing:
        if not rel:
            continue
        p = os.path.join(".", rel)
        if not os.path.isfile(p) or os.path.getsize(p) > 5_000_000:
            continue
        try:
            data = open(p, "rb").read()
        except OSError:
            continue
        if b"\0" in data[:4096]:
            continue
        text = data.decode("utf-8", "replace").splitlines()
        yield rel, list(enumerate(text, start=1))


def main():
    ap = argparse.ArgumentParser()
    mode = ap.add_mutually_exclusive_group(required=True)
    mode.add_argument("--staged", action="store_true", help="проверить то, что в индексе")
    mode.add_argument("--all", action="store_true", help="проверить все отслеживаемые файлы")
    args = ap.parse_args()

    violations = []

    if args.staged:
        names = subprocess.run(["git", "diff", "--cached", "--name-only", "-z"],
                               capture_output=True).stdout.decode().split("\0")
        for rel in filter(None, names):
            if FORBIDDEN_NAMES.search(rel) and not ALLOWED_NAMES.search(rel):
                violations.append((rel, 0, "имя файла доступа", ""))
        for path, lines in staged_lines():
            violations.extend(check_lines(path, lines))
    else:
        for rel, lines in tracked_files():
            if FORBIDDEN_NAMES.search(rel) and not ALLOWED_NAMES.search(rel):
                violations.append((rel, 0, "имя файла доступа", ""))
                continue
            violations.extend(check_lines(rel, lines))

    violations = [v for v in violations if v[0].replace("\\", "/") != SELF]

    if violations:
        print("Найдены похожие на доступы строки. Значения замаскированы, ищи по номеру строки:\n")
        for source, lineno, rule, val in violations:
            extra = " -> " + masked(val) if val else ""
            print("  %s:%s  [%s]%s" % (source, lineno or "-", rule, extra))
        print("\nЕсли это настоящий доступ — убери его из коммита и замени на переменную окружения "
              "(backend/.env не отслеживается, шаблоны — *.env.example).")
        return 1
    print("check-secrets: доступов не найдено")
    return 0


if __name__ == "__main__":
    sys.exit(main())
