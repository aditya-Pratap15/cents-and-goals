Set WshShell = CreateObject("WScript.Shell")
WshShell.CurrentDirectory = "C:\Users\prata\OneDrive\Desktop\Facebook-Automations\4-Cents and Goals"
WshShell.Run "node scripts/fetch_jeff_rose.js", 0, False
