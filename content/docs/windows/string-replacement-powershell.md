<!---

```powershell
# Define an array of old strings and their corresponding new strings
$mapping = @{
    "oldString1" = "newString1";
    "oldString2" = "newString2";
    "oldString3" = "newString3"
}

# Get all files in the current directory
$files = Get-ChildItem -File

# Loop through each file
foreach ($file in $files) {
    # Replace the old strings with the new strings in the filename
    $newFilename = $file.Name
    foreach ($oldString in $mapping.Keys) {
        $newString = $mapping[$oldString]
        $newFilename = $newFilename -replace $oldString, $newString
    }

    # Rename the file with the new filename
    Rename-Item $file.FullName -NewName $newFilename
}
```

--->
