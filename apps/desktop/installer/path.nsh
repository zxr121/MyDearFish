Var InstallerPath
Var InstallerError
; Reject reparse points along the selected path before any write or cleanup.
!macro InstallerValidatePathFunction PREFIX
Function ${PREFIX}InstallerValidatePath
    StrCpy $InstallerError "$(INSTALLER_PATH_INVALID)"
    StrLen $0 $InstallerPath
    ${If} $0 < 4
    ${OrIf} $0 > 180
        Return
    ${EndIf}
    StrCpy $0 $InstallerPath 2 1
    ${If} $0 != ":\"
        Return
    ${EndIf}
    StrCpy $0 $InstallerPath 3
    System::Call 'kernel32::GetDriveTypeW(w r0) i.r1'
    ${If} $1 != 3
        Return
    ${EndIf}
    StrCpy $1 3
    ${Do}
        StrCpy $0 $InstallerPath 1 $1
        ${If} $0 == ""
            ${ExitDo}
        ${EndIf}
        ${If} $0 == ':'
        ${OrIf} $0 == '*'
        ${OrIf} $0 == '?'
        ${OrIf} $0 == '"'
        ${OrIf} $0 == '<'
        ${OrIf} $0 == '>'
        ${OrIf} $0 == '|'
        ${OrIf} $0 == '/'
        ${OrIf} $0 == '$\r'
        ${OrIf} $0 == '$\n'
        ${OrIf} $0 == '$\t'
            Return
        ${EndIf}
        IntOp $1 $1 + 1
    ${Loop}
    StrCpy $2 $InstallerPath
    ${Do}
        StrLen $0 $2
        ${If} $0 <= 3
            ${ExitDo}
        ${EndIf}
        ${GetFileName} $2 $3
        StrCpy $0 $3 1 -1
        ${If} $3 == ""
        ${OrIf} $0 == "."
        ${OrIf} $0 == " "
            Return
        ${EndIf}
        ; Windows reserves device names even when they have an extension.
        StrCpy $5 ""
        StrCpy $6 0
        ${Do}
            StrCpy $0 $3 1 $6
            ${If} $0 == ""
            ${OrIf} $0 == "."
                ${ExitDo}
            ${EndIf}
            StrCpy $5 "$5$0"
            IntOp $6 $6 + 1
        ${Loop}
        ${If} $5 == "CON"
        ${OrIf} $5 == "PRN"
        ${OrIf} $5 == "AUX"
        ${OrIf} $5 == "NUL"
            Return
        ${EndIf}
        StrCpy $0 $5 3
        ${If} $0 == "COM"
        ${OrIf} $0 == "LPT"
            StrLen $0 $5
            StrCpy $5 $5 1 3
            ${If} $0 == 4
            ${AndIf} $5 >= 1
            ${AndIf} $5 <= 9
                Return
            ${EndIf}
        ${EndIf}
        System::Call 'kernel32::GetFileAttributesW(w r2) i.r0'
        ${If} $0 != -1
            IntOp $1 $0 & 0x400
            IntOp $0 $0 & 0x10
            ${If} $1 != 0
            ${OrIf} $0 == 0
                Return
            ${EndIf}
        ${EndIf}
        ${If} $2 == $WINDIR
        ${OrIf} $2 == $PROGRAMFILES32
        ${OrIf} $2 == $PROGRAMFILES64
        ${OrIf} $2 == $PROFILE
        ${OrIf} $2 == $LOCALAPPDATA
            ; Ancestors PROFILE and LOCALAPPDATA are allowed; the selected directory itself is not.
            ${If} $2 == $WINDIR
            ${OrIf} $2 == $PROGRAMFILES32
            ${OrIf} $2 == $PROGRAMFILES64
            ${OrIf} $2 == $InstallerPath
                Return
            ${EndIf}
        ${EndIf}
        ${GetParent} $2 $2
    ${Loop}
    System::Call 'kernel32::GetFullPathNameW(w "$InstallerPath", i ${NSIS_MAX_STRLEN}, w .r4, p 0) i.r0'
    ; Repeated trailing separators can normalize to a drive root.
    ${If} $0 < 4
    ${OrIf} $0 >= ${NSIS_MAX_STRLEN}
        Return
    ${EndIf}
    StrCpy $InstallerPath $4
    StrCpy $InstallerError ""
FunctionEnd
!macroend
!insertmacro InstallerValidatePathFunction ""

; A new installation requires an empty directory; updates require the registered executable.
Function InstallerPreflight
    Call InstallerValidatePath
    ${If} $InstallerError != ""
        Return
    ${EndIf}
    StrCpy $INSTDIR $InstallerPath
    ReadRegStr $0 HKCU "${INSTALL_REGISTRY_KEY}" "InstallLocation"
    ${If} $0 != $INSTDIR
    ${OrIfNot} ${FileExists} "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
        FindFirst $0 $1 "$INSTDIR\*.*"
        ${DoWhile} $1 != ""
            ${If} $1 != "."
            ${AndIf} $1 != ".."
                ; A retained Harness home is the only entry a new installation may adopt.
                StrCpy $3 0
                ${If} $1 == "data"
                    System::Call 'kernel32::GetFileAttributesW(w "$INSTDIR\data") i.r2'
                    ${If} $2 != -1
                        IntOp $3 $2 & 0x10
                        IntOp $2 $2 & 0x400
                        ${If} $3 != 0
                        ${AndIf} $2 == 0
                            StrCpy $3 1
                        ${Else}
                            StrCpy $3 0
                        ${EndIf}
                    ${EndIf}
                ${EndIf}
                ${If} $3 == 0
                    FindClose $0
                    StrCpy $InstallerError "$(INSTALLER_PATH_OWNERSHIP)"
                    Return
                ${EndIf}
            ${EndIf}
            FindNext $0 $1
        ${Loop}
        FindClose $0
    ${EndIf}
    StrCpy $2 $INSTDIR
    ${Do}
        System::Call 'kernel32::GetFileAttributesW(w r2) i.r0'
        ${If} $0 != -1
            ${ExitDo}
        ${EndIf}
        ${GetParent} $2 $2
    ${Loop}
    ${If} $2 == $INSTDIR
        System::Call 'kernel32::GetTempFileNameW(w r2, w "HIL", i 0, w .r3) i.r0'
        ${If} $0 == 0
            StrCpy $InstallerError "$(INSTALLER_PATH_WRITABLE)"
            Return
        ${EndIf}
        System::Call 'kernel32::DeleteFileW(w r3)'
    ${Else}
        ; A standard user may create a directory but not a file at a drive root,
        ; so a missing target is probed with a directory in the nearest existing parent.
        System::Call 'kernel32::GetCurrentProcessId() i.r0'
        System::Call 'kernel32::GetTickCount() i.r1'
        StrCpy $R2 "$2" 1 -1
        ${If} $R2 == "\"
            StrCpy $R2 "$2.dsh-install-probe-$0-$1"
        ${Else}
            StrCpy $R2 "$2\.dsh-install-probe-$0-$1"
        ${EndIf}
        System::Call 'kernel32::CreateDirectoryW(w "$R2", p 0) i.r0'
        ${If} $0 == 0
            StrCpy $InstallerError "$(INSTALLER_PATH_WRITABLE)"
            Return
        ${EndIf}
        System::Call 'kernel32::RemoveDirectoryW(w "$R2") i.r0'
    ${EndIf}
    System::Call 'kernel32::GetDiskFreeSpaceExW(w r2, *l .r0, p 0, p 0) i.r1'
    ${If} $1 == 0
        StrCpy $InstallerError "$(INSTALLER_PATH_WRITABLE)"
        Return
    ${EndIf}
    IntOp $2 ${APP_64_UNPACKED_SIZE} + 65536
    System::Int64Op $2 * 1024
    Pop $2
    System::Int64Op $0 < $2
    Pop $0
    ${If} $0 != 0
        StrCpy $InstallerError "$(INSTALLER_DISK_SPACE)"
    ${EndIf}
FunctionEnd
