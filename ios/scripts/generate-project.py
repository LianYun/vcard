"""Regenerate the dependency-free Xcode project after adding/removing Swift files."""
from pathlib import Path
import hashlib
import json
import plistlib
root = Path(__file__).resolve().parents[1]
objects = {}
def add(key, **value):
    identifier = hashlib.sha1(key.encode()).hexdigest()[:24].upper()
    objects[identifier] = value
    return identifier
def ref(path, kind):
    return add(path, isa='PBXFileReference', lastKnownFileType=kind, path=path, sourceTree='<group>')
files = []
builds = []
for path in sorted((root / 'VibeWord').rglob('*.swift')):
    name = str(path.relative_to(root))
    file = ref(name, 'sourcecode.swift')
    files.append(file)
    builds.append(add('build'+name, isa='PBXBuildFile', fileRef=file))
asset = ref('VibeWord/Resources/Assets.xcassets', 'folder.assetcatalog')
files.append(asset)
asset_build = add('assetbuild', isa='PBXBuildFile', fileRef=asset)
for path, kind in [('VibeWord/Info.plist', 'text.plist.xml'), ('VibeWord/VibeWord.entitlements', 'text.plist.entitlements')]:
    files.append(ref(path, kind))
product = add('product', isa='PBXFileReference', explicitFileType='wrapper.application', path='VibeWord.app', sourceTree='BUILT_PRODUCTS_DIR', includeInIndex='0')
products = add('products', isa='PBXGroup', children=[product], name='Products', sourceTree='<group>')
group = add('group', isa='PBXGroup', children=files+[products], sourceTree='<group>')
phases = []
for key, kind, contents in [('sources', 'PBXSourcesBuildPhase', builds), ('resources', 'PBXResourcesBuildPhase', [asset_build]), ('frameworks', 'PBXFrameworksBuildPhase', [])]:
    phases.append(add(key, isa=kind, buildActionMask='2147483647', files=contents, runOnlyForDeploymentPostprocessing='0'))
base = dict(SDKROOT='iphoneos', IPHONEOS_DEPLOYMENT_TARGET='17.0', SWIFT_VERSION='5.0', CLANG_ENABLE_MODULES='YES', SWIFT_STRICT_CONCURRENCY='targeted')
settings = dict(PRODUCT_BUNDLE_IDENTIFIER='com.lianyun.vibeword', PRODUCT_NAME='$(TARGET_NAME)', TARGETED_DEVICE_FAMILY='1,2', CODE_SIGN_STYLE='Automatic', CODE_SIGN_ENTITLEMENTS='VibeWord/VibeWord.entitlements', INFOPLIST_FILE='VibeWord/Info.plist', GENERATE_INFOPLIST_FILE='NO', ASSETCATALOG_COMPILER_APPICON_NAME='AppIcon', CURRENT_PROJECT_VERSION='1', MARKETING_VERSION='1.0', CLOUDKIT_CONTAINER='iCloud.com.lianyun.vibeword', SUPPORTED_PLATFORMS='iphoneos iphonesimulator')
project_configs = []
target_configs = []
for name in ['Debug', 'Release']:
    project_configs.append(add('project'+name, isa='XCBuildConfiguration', name=name, buildSettings=base | dict(SWIFT_OPTIMIZATION_LEVEL='-Onone' if name == 'Debug' else '-O', SWIFT_ACTIVE_COMPILATION_CONDITIONS='DEBUG' if name == 'Debug' else '')))
    target_configs.append(add('target'+name, isa='XCBuildConfiguration', name=name, buildSettings=settings | dict(APS_ENVIRONMENT='development' if name == 'Debug' else 'production')))
def config(key, entries):
    return add(key, isa='XCConfigurationList', buildConfigurations=entries, defaultConfigurationIsVisible='0', defaultConfigurationName='Release')
pc = config('pc', project_configs)
tc = config('tc', target_configs)
target = add('target', isa='PBXNativeTarget', buildConfigurationList=tc, buildPhases=phases, buildRules=[], dependencies=[], name='VibeWord', productName='VibeWord', productReference=product, productType='com.apple.product-type.application')
test_file = ref('UITests/VibeWordUITests.swift', 'sourcecode.swift')
objects[group]['children'].append(test_file)
test_build = add('uitestbuild', isa='PBXBuildFile', fileRef=test_file)
test_product = add('uitestproduct', isa='PBXFileReference', explicitFileType='wrapper.cfbundle', path='VibeWordUITests.xctest', sourceTree='BUILT_PRODUCTS_DIR')
objects[products]['children'].append(test_product)
test_sources = add('uitestsources', isa='PBXSourcesBuildPhase', buildActionMask='2147483647', files=[test_build], runOnlyForDeploymentPostprocessing='0')
test_configs = [add('uitest'+name, isa='XCBuildConfiguration', name=name, buildSettings=dict(PRODUCT_BUNDLE_IDENTIFIER='com.lianyun.vibeword.uitests', PRODUCT_NAME='$(TARGET_NAME)', GENERATE_INFOPLIST_FILE='YES', TEST_TARGET_NAME='VibeWord', TARGETED_DEVICE_FAMILY='1,2', CODE_SIGN_STYLE='Automatic')) for name in ['Debug','Release']]
test_dep = add('uitestdep', isa='PBXTargetDependency', target=target)
test_target = add('uitesttarget', isa='PBXNativeTarget', buildConfigurationList=config('uitestconfig',test_configs), buildPhases=[test_sources], buildRules=[], dependencies=[test_dep], name='VibeWordUITests', productName='VibeWordUITests', productReference=test_product, productType='com.apple.product-type.bundle.ui-testing')
project = add('project', isa='PBXProject', attributes={'LastUpgradeCheck':'1600', 'TargetAttributes':{target:{'CreatedOnToolsVersion':'16.0', 'SystemCapabilities':{key:{'enabled':'1'} for key in ['com.apple.iCloud', 'com.apple.Push', 'com.apple.BackgroundModes']}}}}, buildConfigurationList=pc, compatibilityVersion='Xcode 14.0', developmentRegion='zh_CN', hasScannedForEncodings='0', knownRegions=['en','zh_CN','Base'], mainGroup=group, productRefGroup=products, projectDirPath='', projectRoot='', targets=[target, test_target])
def fmt(value):
    if isinstance(value, dict): return '{\n'+''.join(json.dumps(k)+' = '+fmt(v)+';\n' for k,v in value.items())+'}'
    if isinstance(value, list): return '('+','.join(fmt(v) for v in value)+')'
    return json.dumps(value)
folder = root/'VibeWord.xcodeproj'
folder.mkdir(exist_ok=True)
(folder/'project.pbxproj').write_text('// !$*UTF8*$!\n'+fmt(dict(archiveVersion='1', classes={}, objectVersion='56', objects=objects, rootObject=project)))
schemes = folder/'xcshareddata'/'xcschemes'
schemes.mkdir(parents=True, exist_ok=True)
reference = f'<BuildableReference BuildableIdentifier="primary" BlueprintIdentifier="{target}" BuildableName="VibeWord.app" BlueprintName="VibeWord" ReferencedContainer="container:VibeWord.xcodeproj"/>'
test_reference = f'<BuildableReference BuildableIdentifier="primary" BlueprintIdentifier="{test_target}" BuildableName="VibeWordUITests.xctest" BlueprintName="VibeWordUITests" ReferencedContainer="container:VibeWord.xcodeproj"/>'
(schemes/'VibeWord.xcscheme').write_text(f'''<?xml version="1.0" encoding="UTF-8"?>
<Scheme LastUpgradeVersion="1600" version="1.3">
<BuildAction parallelizeBuildables="YES" buildImplicitDependencies="YES"><BuildActionEntries><BuildActionEntry buildForTesting="YES" buildForRunning="YES" buildForProfiling="YES" buildForArchiving="YES" buildForAnalyzing="YES">{reference}</BuildActionEntry></BuildActionEntries></BuildAction>
<TestAction buildConfiguration="Debug" selectedDebuggerIdentifier="Xcode.DebuggerFoundation.Debugger.LLDB" selectedLauncherIdentifier="Xcode.IDEFoundation.Launcher.LLDB" shouldUseLaunchSchemeArgsEnv="YES"><Testables><TestableReference skipped="NO">{test_reference}</TestableReference></Testables></TestAction>
<LaunchAction buildConfiguration="Debug" selectedDebuggerIdentifier="Xcode.DebuggerFoundation.Debugger.LLDB" selectedLauncherIdentifier="Xcode.IDEFoundation.Launcher.LLDB" launchStyle="0" useCustomWorkingDirectory="NO" ignoresPersistentStateOnLaunch="NO" debugDocumentVersioning="YES" allowLocationSimulation="YES"><BuildableProductRunnable runnableDebuggingMode="0">{reference}</BuildableProductRunnable></LaunchAction>
<ProfileAction buildConfiguration="Release" shouldUseLaunchSchemeArgsEnv="YES" savedToolIdentifier="" useCustomWorkingDirectory="NO" debugDocumentVersioning="YES"><BuildableProductRunnable runnableDebuggingMode="0">{reference}</BuildableProductRunnable></ProfileAction>
<AnalyzeAction buildConfiguration="Debug"/><ArchiveAction buildConfiguration="Release" revealArchiveInOrganizer="YES"/>
</Scheme>''')
