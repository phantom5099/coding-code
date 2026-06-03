module.exports = {
  hooks: {
    readPackage(pkg) {
      if (pkg.name === 'vitest' || pkg.name === '@vitest/mocker' || pkg.name === 'vite-node') {
        if (pkg.dependencies?.vite) {
          pkg.dependencies.vite = '^6.4.2';
        }
        if (pkg.peerDependencies?.vite) {
          pkg.peerDependencies.vite = '^6.4.2';
        }
      }
      return pkg;
    }
  }
};
