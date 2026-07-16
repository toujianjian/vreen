// Copyright (c) 2026 VREEN. Apache-2.0 license.

using UnrealBuildTool;

public class VreenEditor : ModuleRules
{
    public VreenEditor(ReadOnlyTargetRules Target) : base(Target)
    {
        PCHUsage = PCHUsageMode.UseExplicitOrSharedPCHs;
        IWYUSupport = IWYUSupport.Full;
        CppStandard = CppStandard.Cpp17;
        bUseUnity = false;

        PublicDependencyModuleNames.AddRange(new string[]
        {
            "Core",
            "CoreUObject",
            "Engine",
            "VreenRuntime",
            "Json",
            "JsonUtilities",
            "UnrealEd",
            "EditorScriptingUtilities",
            "AssetRegistry",
        });
    }
}
