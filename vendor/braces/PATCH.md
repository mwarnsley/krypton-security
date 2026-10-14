# Krypton braces security patch

This directory vendors the published `braces@3.0.3` package under its MIT
license. Local version `3.0.4` adds a maximum nesting depth to address
`GHSA-vfj7-8cjw-p6xm` while no patched upstream release is available.

The depth-limit implementation follows all five commits in upstream pull
request `micromatch/braces#72` through head commit
`28d440b5dd449dbf1fe6f3506cf94ecca4d02660`, including the nested-brace
stringification and cyclic-parent follow-ups. Krypton regression tests cover
ordinary brace compilation and expansion, valid nested-brace stringification,
deeply nested string input, and deep or cyclic caller-supplied ASTs.

Replace this package with a reviewed upstream release as soon as one is
published, then remove the local `braces` development dependency and use the
patched registry version in the root override.

After changing this source, regenerate `../braces-3.0.4.tgz` with
`npm pack ./vendor/braces --pack-destination vendor` and review the reported
integrity before updating the lockfile.
