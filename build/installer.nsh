!include LogicLib.nsh

!macro customInit
  ReadRegStr $0 SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY}" "UninstallString"
  ${If} $0 != ""
    DetailPrint "bypassLegacyUninstaller: skipping old uninstall command during upgrade: $0"
    DeleteRegValue SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY}" "UninstallString"
    DeleteRegValue SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY}" "QuietUninstallString"
  ${EndIf}
!macroend

!macro customInstall
  DetailPrint "refreshShortcutIcon: replacing existing shortcuts to refresh icons"
  StrCpy $0 "$INSTDIR\resources\app.asar.unpacked\assets\icons\app-icon.ico"
  ${IfNot} ${FileExists} "$0"
    StrCpy $0 "$appExe"
  ${EndIf}

  ${If} ${FileExists} "$newDesktopLink"
    Delete "$newDesktopLink"
    CreateShortCut "$newDesktopLink" "$appExe" "" "$0" 0 "" "" "${APP_DESCRIPTION}"
    ClearErrors
    WinShell::SetLnkAUMI "$newDesktopLink" "${APP_ID}"
  ${EndIf}

  ${If} ${FileExists} "$newStartMenuLink"
    Delete "$newStartMenuLink"
    CreateShortCut "$newStartMenuLink" "$appExe" "" "$0" 0 "" "" "${APP_DESCRIPTION}"
    ClearErrors
    WinShell::SetLnkAUMI "$newStartMenuLink" "${APP_ID}"
  ${EndIf}
!macroend
