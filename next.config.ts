import path from "node:path";

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * Next 16 blocks dev resources (including the client bundle) for hosts that
   * are not listed here. Automated browser tests connect via 127.0.0.1 while
   * the dev server advertises localhost, so both are allowed.
   */
  allowedDevOrigins: ["localhost", "127.0.0.1"],

  /**
   * `billkit-format` ships raw TypeScript entry points (its package.json maps
   * exports straight to `.ts` files). The build is made to work by
   * `turbopack.root` below; this is the conventional belt-and-braces wiring
   * for a raw-TypeScript dependency.
   */
  transpilePackages: ["billkit-format"],

  /**
   * `billkit-format` is installed as a junction into node_modules, but its real
   * files live one level up in ../shared/billkit-format. Turbopack will not
   * follow a package out of its own root, so the root is widened to the parent
   * directory. This is the change the build actually requires; transpilePackages
   * above is the conventional belt-and-braces wiring for a raw-TypeScript
   * package. Without turbopack.root the build fails with 74x
   * "Module not found: Can't resolve 'billkit-format/package/...'".
   */
  turbopack: {
    root: path.join(__dirname, ".."),
  },
};

export default nextConfig;
