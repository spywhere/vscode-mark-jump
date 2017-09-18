## Mark Jump
[![Version](https://vsmarketplacebadge.apphb.com/version/spywhere.mark-jump.svg)](https://marketplace.visualstudio.com/items?itemName=spywhere.mark-jump)
[![Installs](https://vsmarketplacebadge.apphb.com/installs/spywhere.mark-jump.svg)](https://marketplace.visualstudio.com/items?itemName=spywhere.mark-jump)

Jump to the marked section in the code

![Screenshot](images/screenshot.png)

### What is Mark Jump?
Mark Jump is simply an extension that let you jump across your marking points in the code.

### How to use it?
Simply install the extension, Mark Jump should show the mark count in the status bar!
Use arrow keys to jump between them, click to jump to it.

You can also use the following key bindings to jump through various type of marks...

- `Ctrl+Alt+P` / `Ctrl+Cmd+P` (`markJump.jumpToProjectMarks`): Jump to all marks in the project
- `Ctrl+Alt+M` / `Ctrl+Cmd+M` (`markJump.jumpToMarks`): Jump to all marks (either in current editor or a whole project)
- `Ctrl+Alt+S` / `Ctrl+Cmd+S` (`markJump.jumpToEditorMarks.section`): Jump to all section marks (in current editor)
- `Ctrl+Alt+T` / `Ctrl+Cmd+T` (`markJump.jumpToEditorMarks.todo`): Jump to all TODOs (in current editor)
- `Ctrl+Alt+N` / `Ctrl+Cmd+N` (`markJump.jumpToEditorMarks.note`): Jump to all Notes (in current editor)

- `Ctrl+Alt+,` / `Ctrl+Cmd+,` (`markJump.jumpToPreviousMark`): Jump to previous mark (in current editor)
- `Ctrl+Alt+.` / `Ctrl+Cmd+.` (`markJump.jumpToNextMark`): Jump to next mark (in current editor)

### How to write the marks?
Just simply write one of these syntax in your code, Mark Jump will found it right away!

You can also add more syntax via the configurations (pull requests are welcomed).

#### Section Marks
- `// MARK: Section name`
- `# pragma Section name` (case sensitive)

#### TODOs
- `// TODO: Text goes here`
- `// TODO(writer name): Text goes here`

#### Notes
- `// NOTE: Text goes here`
- `// NOTE(writer name): Text goes here`

#### Mark Filter
You can custom how "Jump to previous/next mark" jump by use a specific command instead of general one.

- To filter only "Section" mark, add `.section` after a command name.
- To filter only "To Do" mark, add `.todo` after a command name.
- To filter only "Note" mark, add `.note` after a command name.
