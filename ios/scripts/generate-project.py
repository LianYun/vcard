"""Regenerate the dependency-free Xcode project after adding/removing Swift files."""
from pathlib import Path
import hashlib
import json
import plistlib
import subprocess
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
link_file = ref('Shared/WatchLink.swift', 'sourcecode.swift')
files.append(link_file)
builds.append(add('buildwatchlink', isa='PBXBuildFile', fileRef=link_file))
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
settings = dict(PRODUCT_BUNDLE_IDENTIFIER='com.lianyun.vibeword', PRODUCT_NAME='$(TARGET_NAME)', TARGETED_DEVICE_FAMILY='1,2', CODE_SIGN_STYLE='Automatic', CODE_SIGN_ENTITLEMENTS='VibeWord/VibeWord.entitlements', INFOPLIST_FILE='VibeWord/Info.plist', GENERATE_INFOPLIST_FILE='NO', ASSETCATALOG_COMPILER_APPICON_NAME='AppIcon', CURRENT_PROJECT_VERSION='1', MARKETING_VERSION='1.0', SUPPORTED_PLATFORMS='iphoneos iphonesimulator')
project_configs = []
target_configs = []
for name in ['Debug', 'Release']:
    project_configs.append(add('project'+name, isa='XCBuildConfiguration', name=name, buildSettings=base | dict(SWIFT_OPTIMIZATION_LEVEL='-Onone' if name == 'Debug' else '-O', SWIFT_ACTIVE_COMPILATION_CONDITIONS='DEBUG' if name == 'Debug' else '')))
    target_configs.append(add('target'+name, isa='XCBuildConfiguration', name=name, buildSettings=settings.copy()))
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
def watch_target(key, name, paths, bundle, info, product_type, extra=None):
    refs = [ref(path, 'sourcecode.swift') for path in paths]
    objects[group]['children'].extend(r for r in refs if r not in objects[group]['children'])
    sources = add(key+'sources', isa='PBXSourcesBuildPhase', buildActionMask='2147483647',
                  files=[add(key+path, isa='PBXBuildFile', fileRef=r) for path,r in zip(paths,refs)], runOnlyForDeploymentPostprocessing='0')
    extension = '.appex' if product_type.endswith('app-extension') else '.app'
    product = add(key+'product', isa='PBXFileReference', explicitFileType='wrapper.app-extension' if extension == '.appex' else 'wrapper.application', path=name+extension, sourceTree='BUILT_PRODUCTS_DIR', includeInIndex='0')
    objects[products]['children'].append(product)
    values = dict(SDKROOT='watchos', WATCHOS_DEPLOYMENT_TARGET='10.0', TARGETED_DEVICE_FAMILY='4',
                  SUPPORTED_PLATFORMS='watchos watchsimulator', PRODUCT_NAME='$(TARGET_NAME)',
                  PRODUCT_BUNDLE_IDENTIFIER=bundle, CODE_SIGN_STYLE='Automatic', GENERATE_INFOPLIST_FILE='NO',
                  INFOPLIST_FILE=info, CURRENT_PROJECT_VERSION='1', MARKETING_VERSION='1.0',
                  WATCH_APP_GROUP='group.com.lianyun.vibeword.watch', SKIP_INSTALL='YES',
                  LD_RUNPATH_SEARCH_PATHS='$(inherited) @executable_path/Frameworks @executable_path/../../Frameworks')
    values.update(extra or {})
    configs = [add(key+n, isa='XCBuildConfiguration', name=n, buildSettings=values.copy()) for n in ['Debug','Release']]
    t = add(key+'target', isa='PBXNativeTarget', buildConfigurationList=config(key+'config',configs), buildPhases=[sources], buildRules=[], dependencies=[], name=name, productName=name, productReference=product, productType=product_type)
    return t,product

shared_core = ['VibeWord/Core/'+name for name in ['Models.swift','FSRSVendor.swift','FSRSScheduler.swift','SyncEvent.swift','Anki.swift','JSONEventStore.swift','WatchStudy.swift','Localization.swift','EnglishMessages.swift']]
watch,watch_product = watch_target('watch','VibeWordWatch',
    shared_core + ['Shared/WatchLink.swift','Shared/WatchSummary.swift'] + [str(p.relative_to(root)) for p in sorted((root/'WatchApp').glob('*.swift'))],
    'com.lianyun.vibeword.watchkitapp','WatchApp/Info.plist','com.apple.product-type.application',
    dict(COMPANION_BUNDLE_IDENTIFIER='com.lianyun.vibeword', CODE_SIGN_ENTITLEMENTS='WatchApp/Watch.entitlements', ASSETCATALOG_COMPILER_APPICON_NAME='AppIcon'))
watch_asset = ref('WatchApp/Assets.xcassets','folder.assetcatalog')
objects[group]['children'].append(watch_asset)
objects[watch]['buildPhases'].append(add('watchresources',isa='PBXResourcesBuildPhase',buildActionMask='2147483647',files=[add('watchassetbuild',isa='PBXBuildFile',fileRef=watch_asset)],runOnlyForDeploymentPostprocessing='0'))
widget,widget_product = watch_target('widget','VibeWordWatchWidgets',
    ['VibeWord/Core/Models.swift','VibeWord/Core/FSRSVendor.swift','VibeWord/Core/FSRSScheduler.swift','VibeWord/Core/SyncEvent.swift','VibeWord/Core/Anki.swift','VibeWord/Core/JSONEventStore.swift','VibeWord/Core/Localization.swift','VibeWord/Core/EnglishMessages.swift','Shared/WatchSummary.swift','WatchWidgets/WatchWidgets.swift'],
    'com.lianyun.vibeword.watchkitapp.widgets','WatchWidgets/Info.plist','com.apple.product-type.app-extension',
    dict(CODE_SIGN_ENTITLEMENTS='WatchWidgets/Watch.entitlements', APPLICATION_EXTENSION_API_ONLY='YES'))
def embed(parent, child, product, key, destination, path=''):
    dep = add(key+'dep',isa='PBXTargetDependency',target=child)
    objects[parent]['dependencies'].append(dep)
    build = add(key+'build',isa='PBXBuildFile',fileRef=product,settings={'ATTRIBUTES':['RemoveHeadersOnCopy']})
    phase = add(key+'phase',isa='PBXCopyFilesBuildPhase',buildActionMask='2147483647',dstPath=path,dstSubfolderSpec=destination,files=[build],name=key,runOnlyForDeploymentPostprocessing='0')
    objects[parent]['buildPhases'].append(phase)
embed(watch,widget,widget_product,'Embed Watch Widgets','13')
embed(target,watch,watch_product,'Embed Watch Content','16','$(CONTENTS_FOLDER_PATH)/Watch')
watch_test_file = ref('WatchUITests/WatchUITests.swift','sourcecode.swift')
objects[group]['children'].append(watch_test_file)
watch_test_product = add('watchtestproduct',isa='PBXFileReference',explicitFileType='wrapper.cfbundle',path='VibeWordWatchUITests.xctest',sourceTree='BUILT_PRODUCTS_DIR')
objects[products]['children'].append(watch_test_product)
watch_test_sources = add('watchtestsources',isa='PBXSourcesBuildPhase',buildActionMask='2147483647',files=[add('watchtestbuild',isa='PBXBuildFile',fileRef=watch_test_file)],runOnlyForDeploymentPostprocessing='0')
watch_test_configs = [add('watchtest'+n,isa='XCBuildConfiguration',name=n,buildSettings=dict(SDKROOT='watchos',WATCHOS_DEPLOYMENT_TARGET='10.0',SUPPORTED_PLATFORMS='watchos watchsimulator',TARGETED_DEVICE_FAMILY='4',PRODUCT_BUNDLE_IDENTIFIER='com.lianyun.vibeword.watchuitests',PRODUCT_NAME='$(TARGET_NAME)',GENERATE_INFOPLIST_FILE='YES',TEST_TARGET_NAME='VibeWordWatch',CODE_SIGN_STYLE='Automatic')) for n in ['Debug','Release']]
watch_test = add('watchtesttarget',isa='PBXNativeTarget',buildConfigurationList=config('watchtestconfig',watch_test_configs),buildPhases=[watch_test_sources],buildRules=[],dependencies=[add('watchtestdep',isa='PBXTargetDependency',target=watch)],name='VibeWordWatchUITests',productName='VibeWordWatchUITests',productReference=watch_test_product,productType='com.apple.product-type.bundle.ui-testing')
project = add('project', isa='PBXProject', attributes={'LastUpgradeCheck':'1600', 'TargetAttributes':{target:{'CreatedOnToolsVersion':'16.0', 'SystemCapabilities':{key:{'enabled':'1'} for key in []}},watch:{'CreatedOnToolsVersion':'16.0','SystemCapabilities':{'com.apple.ApplicationGroups.iOS':{'enabled':'1'}}},widget:{'CreatedOnToolsVersion':'16.0','SystemCapabilities':{'com.apple.ApplicationGroups.iOS':{'enabled':'1'}}}}}, buildConfigurationList=pc, compatibilityVersion='Xcode 14.0', developmentRegion='en', hasScannedForEncodings='0', knownRegions=['en','zh-Hans','Base'], mainGroup=group, productRefGroup=products, projectDirPath='', projectRoot='', targets=[target, test_target, watch, widget])
def fmt(value):
    if isinstance(value, dict): return '{\n'+''.join(json.dumps(k)+' = '+fmt(v)+';\n' for k,v in value.items())+'}'
    if isinstance(value, list): return '('+','.join(fmt(v) for v in value)+')'
    return json.dumps(value)
objects[project]['targets'].append(watch_test)
folder = root/'VibeWord.xcodeproj'
folder.mkdir(exist_ok=True)
# Preserve the user's signing/team settings when adding source files.
previous_project = folder / 'project.pbxproj'
if previous_project.exists():
    previous = json.loads(subprocess.check_output(['plutil', '-convert', 'json', '-o', '-', str(previous_project)]))
    for identifier, obj in objects.items():
        old = previous['objects'].get(identifier, {})
        if obj.get('isa') == 'XCBuildConfiguration':
            for key in ['DEVELOPMENT_TEAM', 'CODE_SIGN_IDENTITY', 'PROVISIONING_PROFILE_SPECIFIER', 'PRODUCT_BUNDLE_IDENTIFIER']:
                if key in old.get('buildSettings', {}):
                    obj['buildSettings'][key] = old['buildSettings'][key]
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
watch_reference = f'<BuildableReference BuildableIdentifier="primary" BlueprintIdentifier="{watch}" BuildableName="VibeWordWatch.app" BlueprintName="VibeWordWatch" ReferencedContainer="container:VibeWord.xcodeproj"/>'
watch_test_reference = f'<BuildableReference BuildableIdentifier="primary" BlueprintIdentifier="{watch_test}" BuildableName="VibeWordWatchUITests.xctest" BlueprintName="VibeWordWatchUITests" ReferencedContainer="container:VibeWord.xcodeproj"/>'
(schemes/'VibeWordWatch.xcscheme').write_text(f'''<?xml version="1.0" encoding="UTF-8"?>
<Scheme LastUpgradeVersion="1600" version="1.3">
<BuildAction parallelizeBuildables="YES" buildImplicitDependencies="YES"><BuildActionEntries><BuildActionEntry buildForTesting="YES" buildForRunning="YES" buildForProfiling="YES" buildForArchiving="YES" buildForAnalyzing="YES">{watch_reference}</BuildActionEntry></BuildActionEntries></BuildAction>
<TestAction buildConfiguration="Debug" selectedDebuggerIdentifier="Xcode.DebuggerFoundation.Debugger.LLDB" selectedLauncherIdentifier="Xcode.IDEFoundation.Launcher.LLDB" shouldUseLaunchSchemeArgsEnv="YES"><Testables><TestableReference skipped="NO">{watch_test_reference}</TestableReference></Testables></TestAction>
<LaunchAction buildConfiguration="Debug" selectedDebuggerIdentifier="Xcode.DebuggerFoundation.Debugger.LLDB" selectedLauncherIdentifier="Xcode.IDEFoundation.Launcher.LLDB" launchStyle="0" useCustomWorkingDirectory="NO" ignoresPersistentStateOnLaunch="NO" debugDocumentVersioning="YES"><BuildableProductRunnable runnableDebuggingMode="0">{watch_reference}</BuildableProductRunnable></LaunchAction>
<ProfileAction buildConfiguration="Release" shouldUseLaunchSchemeArgsEnv="YES" savedToolIdentifier="" useCustomWorkingDirectory="NO" debugDocumentVersioning="YES"><BuildableProductRunnable runnableDebuggingMode="0">{watch_reference}</BuildableProductRunnable></ProfileAction>
<AnalyzeAction buildConfiguration="Debug"/><ArchiveAction buildConfiguration="Release" revealArchiveInOrganizer="YES"/>
</Scheme>''')
