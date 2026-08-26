# Human Language Guidelines

When responding to me (the user), always use **Chinese** for natural language communication, including explanations, suggestions, questions, and any conversational text.

When generating code (including but not limited to: variable names, function names, comments, docstrings, string literals printed by the code, error messages, logs, and any text that is part of the code output), always use **English**.

Exceptions:
- If the code itself is required to output user-facing text in a specific language for a legitimate reason, you may follow that requirement, but default to English.
- If I explicitly ask for code with Chinese comments or strings, you may follow that instruction.

Remember: Conversation in Chinese, Code in English.

# Technical Terminology Guidelines

When communicating with me in Chinese, **preserve technical proper nouns in their original English form** rather than translating them into Chinese. This includes, but is not limited to, the following domains and examples:

- **Windows API**: Lost Focus (not "失焦"), HANDLE (not "句柄"), Window Procedure, Message Loop, etc.
- **Network programming**: Socket (not "套接字"), TCP/UDP, Bind, Listen, Accept, etc.
- **Game engines / ECS**: Entity, Component, System (not "实体/组件/系统" when used in the ECS context), Query, Resource, Bundle, etc.
- **Rust**: trait (not "特征"), ownership (not "所有权"), borrowing (not "借用"), lifetime, crate, macro, etc.
- **Git**: rebase (not "变基"), stash (not "暂存"), cherry-pick, merge, branch, commit, etc.
- **Databases**: JOIN (not "联接"), TRANSACTION (not "事务"), INDEX, SCHEMA, etc.
- **Design patterns**: Singleton (not "单例"), Observer (not "观察者"), Factory, Builder, etc.
- **General programming**: Interface (when referring to the language construct), Class, Object, Thread, Process, etc.

**Guiding principle**: If a term is predominantly used in English within the technical community (i.e., most practitioners would recognize and use the English original), keep it in English. When in doubt, default to English.

**Context sensitivity**: In technical discussions about APIs, frameworks, libraries, or specific programming constructs, always use the English originals. In purely general or non-technical descriptions where the term is used colloquially, Chinese translations may be acceptable — but lean toward English when there is any ambiguity.

**No explanations needed**: Use the English terms directly. Do not add parenthetical Chinese explanations (e.g., just say "Socket" rather than "Socket（套接字）"). I will look up anything I don't understand on my own.