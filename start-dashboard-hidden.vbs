' Starts the local dashboard server WITHOUT a black console window, then opens the browser.
' The server keeps running in the background until the PC shuts down or stop-dashboard.bat is run.
' Run with "/silent" to start the server only (no browser) - used for auto-start at Windows login.
' Server output goes to scripts\server-log.txt.
Option Explicit
Dim sh, fso, dir, silent, i
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
dir = fso.GetParentFolderName(WScript.ScriptFullName)
sh.CurrentDirectory = dir
silent = (WScript.Arguments.Count > 0)

Function IsRunning()
  IsRunning = (sh.Run("cmd /c netstat -ano | findstr /R /C:"":3000 .*LISTENING"" >nul", 0, True) = 0)
End Function

If Not IsRunning() Then
  sh.Run "cmd /c node server.js >> scripts\server-log.txt 2>&1", 0, False
  ' wait up to ~10 seconds for the server to come up
  For i = 1 To 20
    WScript.Sleep 500
    If IsRunning() Then Exit For
  Next
End If

If Not silent Then sh.Run "http://localhost:3000", 1, False
