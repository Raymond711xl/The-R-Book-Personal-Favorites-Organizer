# Security / 安全说明

## 中文

这个项目会处理登录后可见的收藏页面、临时访问参数、个人归档和可选的知识库凭证。请默认把 `config.json`、`workbench.config.json`、`archive/`、`data/`、`work/`、`reports/`、`review/` 与 `site/` 视为私有内容。

如果发现安全问题，请优先使用 GitHub Private Vulnerability Reporting；在私密通道建立前，不要在公开 Issue 中粘贴 Cookie、`xsecToken`、API Key、个人收藏或可复现的私人页面快照。

项目不会要求用户提交账号密码。登录、验证码和二次验证应由用户本人在本地浏览器中完成。任何外部知识库写入都应先经过只读鉴权、权限确认和单条测试。

## English

This project may process signed-in collection pages, temporary access parameters, personal archives, and optional knowledge-base credentials. Treat `config.json`, `workbench.config.json`, `archive/`, `data/`, `work/`, `reports/`, `review/`, and `site/` as private by default.

Report vulnerabilities through GitHub Private Vulnerability Reporting when available. Do not paste cookies, `xsecToken` values, API keys, personal saves, or private page snapshots into a public issue.

The project should never require an account password. Users must complete login, CAPTCHA, and two-factor verification themselves in a local browser. Verify read-only authentication, permissions, and one test item before enabling external knowledge-base writes.
