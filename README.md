# SmileMML

SmileBASIC3 compatible MML player / visualizer.
https://smilemml.natrium144.org/

* Compatible with the MML syntax of SmileBASIC3 and reproduces the behavior of all parameters, including envelopes (`@E`) and modulation (`@MA`, `@MP`, `@ML`).
* Visualizes the notes and parameters of each channel in real time. It also allows pausing and resuming playback of MML.

### Note

* SmileMML has looser syntax constraints than SmileBASIC3, accepting parameters outside the specified range and sometimes not displaying errors even with grammatical errors.
* The sound is not identical to SmileBASIC3; it uses free soundfonts as a substitute.
  * (If you have a PetitComputer ROM obtained by some means, you can also use its sound source for playback.)
* MML and sound data loaded by SmileMML are not sent to a server or externally; all processing is done within this browser.

## Development

Install Node.js and pnpm 12.

```sh
pnpm install
pnpm run dev
```

## License

© 2026 na-trium-144

SmileMML is licensed under GPL-3.0. See [LICENSE](./LICENSE)

MML parsing is based on Visual MML ver1.1.2 (© 2019-2020 na-trium-144 _a.k.a._ Na).

Audio processing is implemented referencing the code of
* [DanielPXL/nitro-play](https://github.com/DanielPXL/nitro-play) (GPL-3.0)
* [marmooo/midy](https://github.com/marmooo/midy) (Apache-2.0)

The soundfont included under [./public](./public) is a compressed version of the following, converted to sf3 using [sf3convert](https://github.com/musescore/sftools):
* [GeneralUser GS](https://schristiancollins.com/generaluser.php) 2.0.3
* FluidR3_GM (MIT)
