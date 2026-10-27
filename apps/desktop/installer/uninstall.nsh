; Electron user data and updater downloads leave with the application unless the owner keeps them.
; The packaged Harness home is the fish's memory; the owner decides whether it leaves.
!include FileFunc.nsh
Var UnTarget
Var UnHome

; The helper refuses unsafe roots, the installation and the Harness home, and never descends into reparse points;
; a locked file leaves residue and never fails the uninstall. customCheckAppRunning extracts window-frame.dll first.
Function un.RemoveData
  System::Call '$PLUGINSDIR\window-frame.dll::UninstallRemoveData(w "$UnTarget", w "$INSTDIR", w "$UnHome") ?c'
FunctionEnd

Function un.CleanData
  ${If} ${isUpdated}
    Return
  ${EndIf}
  ; The installer runs an older uninstaller with /KEEP_APP_DATA when replacing it from another directory.
  ${GetParameters} $R0
  ClearErrors
  ${GetOptions} $R0 "/KEEP_APP_DATA" $R1
  ${IfNot} ${Errors}
    Return
  ${EndIf}
  ; Only a DSH_HOME published as a Windows environment variable is visible here.
  ReadEnvStr $UnHome DSH_HOME
  ClearErrors
  StrCpy $UnTarget "$APPDATA\${PRODUCT_FILENAME}"
  Call un.RemoveData
  !ifdef APP_PACKAGE_NAME
    ; Electron derives user data from the package name; a scoped name nests it one directory deeper.
    StrCpy $UnTarget "$APPDATA\${APP_PACKAGE_NAME}"
    Call un.RemoveData
    System::Call '$PLUGINSDIR\window-frame.dll::UninstallRemoveEmptyParents(w "$UnTarget", w "$APPDATA") ?c'
  !endif
  StrCpy $UnTarget "$LOCALAPPDATA\${DSH_UPDATER_CACHE_NAME}"
  Call un.RemoveData
FunctionEnd

; Ask before deleting the fish's memory; only an explicit Yes removes the packaged Harness home.
; Silent uninstalls keep it, and a linked or non-directory data entry is never followed.
Function un.AskRemoveHome
  ${If} ${Silent}
    Return
  ${EndIf}
  System::Call 'kernel32::GetFileAttributesW(w "$INSTDIR\data") i.r0'
  ${If} $0 == -1
    Return
  ${EndIf}
  IntOp $1 $0 & 0x10
  IntOp $2 $0 & 0x400
  ${If} $1 == 0
  ${OrIf} $2 != 0
    Return
  ${EndIf}
  ; Anything but Yes keeps the memory, including closing the prompt.
  MessageBox MB_YESNO|MB_ICONQUESTION "$(UNINSTALLER_DELETE_DATA)$\r$\n$INSTDIR\data" /SD IDNO IDYES dshDeleteHome
  Goto dshKeepHome
dshDeleteHome:
  System::Call '$PLUGINSDIR\window-frame.dll::UninstallRemoveHome(w "$INSTDIR", w "$UnHome") i.r3 ?c'
  ${If} $3 != 0
    MessageBox MB_OK|MB_ICONEXCLAMATION "$(UNINSTALLER_DATA_DELETE_FAILED)$\r$\n$INSTDIR\data" /SD IDOK
  ${EndIf}
dshKeepHome:
  ClearErrors
FunctionEnd
