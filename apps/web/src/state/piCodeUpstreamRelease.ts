import { compareSemverVersions } from "@t3tools/shared/semver";
import * as Effect from "effect/Effect";
import * as Schedule from "effect/Schedule";
import * as Stream from "effect/Stream";
import { FetchHttpClient, HttpClient } from "effect/http";
import { Atom } from "effect/reactivity";

export const T3_UPSTREAM_REPOSITORY = "https://github.com/pingdotgg/t3code";
// Last stable release fully incorporated, plus the exact upstream commit the fork is based on.
export const PI_CODE_UPSTREAM_BASELINE = {
  version: "v0.1.11",
  commit: "0948100035d7710b3d5410fee975f8960c1824eb",
};

const checkUpstreamRelease = Effect.gen(function* () {
  const response = yield* HttpClient.get(
    "https://api.github.com/repos/pingdotgg/t3code/releases/latest",
  );
  if (response.status !== 200) return undefined;
  const release = yield* response.json;
  if (
    typeof release !== "object" ||
    release === null ||
    !("tag_name" in release) ||
    typeof release.tag_name !== "string" ||
    !/^v\d+\.\d+\.\d+$/.test(release.tag_name)
  ) {
    return undefined;
  }
  return compareSemverVersions(release.tag_name, PI_CODE_UPSTREAM_BASELINE.version) > 0
    ? release.tag_name
    : null;
}).pipe(
  Effect.provideService(FetchHttpClient.RequestInit, { credentials: "omit" }),
  // GitHub's CORS policy does not allow trace headers on renderer requests.
  Effect.provideService(HttpClient.TracerPropagationEnabled, false),
  Effect.provide(FetchHttpClient.layer),
  Effect.timeout("10 seconds"),
  Effect.orElseSucceed(() => undefined),
);

export const piCodeUpstreamReleaseAtom = Atom.make(
  Stream.fromEffectSchedule(checkUpstreamRelease, Schedule.spaced("1 hour")).pipe(
    Stream.filter((release) => release !== undefined),
  ),
  { initialValue: null },
).pipe(Atom.keepAlive, Atom.withLabel("pi-code:upstream-release"));
