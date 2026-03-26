# 🤝 Contributing

Thank you for your interest in contributing to Mini POS Market!

## 🐛 Reporting Bugs

Use the [Bug Report](.github/ISSUE_TEMPLATE/bug_report.md) template.  
Include: browser name + version, steps to reproduce, expected vs actual behavior.

## 💡 Suggesting Features

Use the [Feature Request](.github/ISSUE_TEMPLATE/feature_request.md) template.

## 🔧 Making Changes

1. Fork the repository
2. Create a branch: `git checkout -b feature/your-feature-name`
3. Make your changes in `index.html`
4. Test in at least Chrome and Firefox
5. Submit a Pull Request with a clear description

## 📐 Code Style

- Vanilla JS only — no frameworks or libraries
- Keep everything in a single `index.html` file
- Use CSS variables for all colors (`var(--color-*)`)
- Comments in English
- Functions should do one thing

## ✅ Testing Checklist

Before submitting a PR, verify:
- [ ] Works offline (no network requests)
- [ ] Dark mode looks correct
- [ ] Mobile/responsive layout not broken
- [ ] CSV import/export still works
- [ ] localStorage data persists across page reloads
