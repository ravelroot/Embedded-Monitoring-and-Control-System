const { readFile, writeFile } = require('node:fs/promises');
const { join } = require('node:path');

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'win32') {
    return;
  }
  const { NtExecutable, NtExecutableResource, Data, Resource } = await import('resedit');
  const version = context.packager.appInfo.version;
  const exePath = join(context.appOutDir, `${context.packager.appInfo.productFilename}.exe`);
  const executable = NtExecutable.from(await readFile(exePath));
  const resources = NtExecutableResource.from(executable);
  const iconFile = Data.IconFile.from(await readFile(join(context.packager.projectDir, 'assets', 'icon.ico')));
  Resource.IconGroupEntry.replaceIconsForResource(
    resources.entries,
    1,
    1033,
    iconFile.icons.map((item) => item.data),
  );
  const [info] = Resource.VersionInfo.fromEntries(resources.entries);
  const parts = version.split('.').map(Number);
  info.setFileVersion(parts[0], parts[1], parts[2], 0, 1033);
  info.setProductVersion(parts[0], parts[1], parts[2], 0, 1033);
  info.setStringValues(
    { lang: 1033, codepage: 1200 },
    {
      FileDescription: 'Malha',
      ProductName: 'Malha',
      CompanyName: 'Malha',
      LegalCopyright: 'Copyright (c) 2026 Malha',
      OriginalFilename: 'Malha.exe',
      InternalName: 'Malha',
      FileVersion: version,
      ProductVersion: version,
    },
  );
  info.outputToResourceEntries(resources.entries);
  resources.outputResource(executable);
  await writeFile(exePath, Buffer.from(executable.generate()));
};
