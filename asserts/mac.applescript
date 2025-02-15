property fileTypes : {{«class PNGf», ".png"}}
property pathTypes : {{«class furl»}}

on run argv
	if argv is {} then
		return ""
	end if
	set clipboardInfo to clipboard info
	if (clipboardInfo as text) contains "«class furl»" then
		-- 获取剪贴板内容
		set clipboardContent to the clipboard as «class furl»
		
		set clipboardFileNames to (the clipboard as string)
		--return clipboardFileNames
		-- 提取文件名列表
		set AppleScript's text item delimiters to "\r"
		set fileNames to text items of clipboardFileNames
		set AppleScript's text item delimiters to ""
		
		-- 提取第一个文件路径
		set firstFilePath to POSIX path of (clipboardContent)
		
		-- 获取第一个文件路径的目录
		set AppleScript's text item delimiters to "/"
		set pathComponents to text items of firstFilePath
		set AppleScript's text item delimiters to "/"
		set firstFileDirectory to (items 1 thru -2 of pathComponents) as string
		
		-- 拼接完整的文件路径
		set fileList to {}
		repeat with fileName in fileNames
			set end of fileList to firstFileDirectory & "/" & fileName
		end repeat
		
		set filePaths to ""
		repeat with filePath in fileList
			set filePaths to filePaths & filePath & "\n"
		end repeat
		
		return filePaths
	else
		set imagePath to (item 1 of argv)
		set theType to getType()
		
		if theType is not missing value then
			try
				set myFile to (open for access imagePath with write permission)
				set eof myFile to 0
				write (the clipboard as (first item of theType)) to myFile
				close access myFile
				return (POSIX path of imagePath)
			on error
				try
					close access myFile
				end try
				return ""
			end try
		else
			return "no image"
		end if
	end if
end run

on getType()
	repeat with aType in fileTypes
		repeat with theInfo in (clipboard info)
			if (first item of theInfo) is equal to (first item of aType) then return aType
		end repeat
	end repeat
	return missing value
end getType