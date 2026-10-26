Set WshShell = CreateObject("WScript.Shell")
WshShell.CurrentDirectory = "C:\Users\prata\OneDrive\Desktop\Facebook-Automations\4-Cents and Goals"
WshShell.Run "cmd.exe /c node scripts/fetch_jeff_rose.js >> task_scheduler.log 2>&1", 0, False
