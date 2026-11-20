#!/bin/bash
python3 build_tz.py ТЗ_MediaBoard.docx $1 >/dev/null
osascript -e 'tell application "Microsoft Word"
open POSIX file "/Users/kik8/Desktop/projects/relay/tz_mediaboard/ТЗ_MediaBoard.docx"
save as active document file name "/Users/kik8/Desktop/projects/relay/tz_mediaboard/ТЗ_MediaBoard.pdf" file format format PDF
close active document saving no
end tell' >/dev/null 2>&1
mdls -name kMDItemNumberOfPages ТЗ_MediaBoard.pdf
