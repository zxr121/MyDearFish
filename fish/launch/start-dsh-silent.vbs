Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")
sh.Run """" & fso.GetParentFolderName(WScript.ScriptFullName) & "\start-dsh.bat"" --auto", 0, False
