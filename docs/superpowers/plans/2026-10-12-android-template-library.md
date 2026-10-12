# Android Template Library - Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the Android app list the template catalog published by the server, download a package on demand into local storage, and render a chosen one through the existing fill/print flow.

**Architecture:** A new `feature:templates` module follows the existing `domain`/`data`/`presentation` split. A Ktor client fetches the catalog and package bytes; a file-backed store keeps downloaded archives under `filesDir`; a repository verifies each download's SHA-256 against the catalog id **before** writing it. The Templates screen gets its own ViewModel so it never instantiates the renderer's WebView, and the renderer gains one new action for "open a stored template" instead of a second code path.

**Tech Stack:** Kotlin 2.2.10, Ktor client 3.6.0, kotlinx.serialization 1.9.0, coroutines 1.10.2, Koin 4.1.1, Compose BOM 2026.02.01, JUnit 5 + Turbine + AssertK.

**Spec:** `docs/superpowers/specs/2026-10-12-template-server-design.md` — see *Android*.

## Global Constraints

- **Gradle always runs with `--no-configuration-cache`.** AGP 9.4.1 cannot serialise it for this build, and `gradle.properties` still sets `org.gradle.configuration-cache=true`, so the flag is the only thing that works.
- **Use `single<T> { }`, never `singleOf(::…)`.** Documented as unresolvable from a plain library module in this Koin release.
- **Always write the explicit type on `get()`** — an unqualified `get()` infers the definition's own type and recurses until the stack overflows.
- **New `DataError` cases must get a string** in `core/presentation/src/main/res/values/strings.xml`. `DataError.toUiText()` is an exhaustive `when`, so a missing string is a compile error.
- **Test conventions:** one shared `StandardTestDispatcher` passed to `runTest`; Turbine for `events` only, never `state`; hand-written fakes, no mocking library; AssertK; backtick test names.
- **`FileTemplateStore` takes a `File`, not a `Context`,** so it is unit-testable without Robolectric, which this project does not have.
- **Cleartext config is `src/debug/` only.** Release must have no reference to it.
- Gate: `.\gradlew.bat --no-configuration-cache assembleDebug testDebugUnitTest lintDebug`

---

### Task 1: Wires that do not exist yet — Ktor, INTERNET, cleartext, server URL

Nothing is testable until the module resolves, so this task is wiring plus a smoke test that proves the dependency graph is sound.

**Files:**
- Modify: `Android/gradle/libs.versions.toml`
- Modify: `Android/app/build.gradle.kts`
- Modify: `Android/app/src/main/AndroidManifest.xml`
- Create: `Android/app/src/debug/res/xml/network_security_config.xml`
- Create: `Android/app/src/debug/AndroidManifest.xml`
- Test: `Android/app/src/test/kotlin/com/billkit/host/BuildConfigTest.kt`

**Interfaces:**
- Consumes: nothing.
- Produces: `com.billkit.host.BuildConfig.SERVER_URL: String`, resolvable `libs.ktor.*` aliases, and an emulator that can reach a plain-HTTP dev server.

- [ ] **Step 1: Add the Ktor version and libraries to the catalog**

In `Android/gradle/libs.versions.toml`, add under `[versions]`:
```toml
ktor = "3.6.0"
```
and under `[libraries]`:
```toml
ktor-client-core = { group = "io.ktor", name = "ktor-client-core", version.ref = "ktor" }
ktor-client-okhttp = { group = "io.ktor", name = "ktor-client-okhttp", version.ref = "ktor" }
ktor-client-content-negotiation = { group = "io.ktor", name = "ktor-client-content-negotiation", version.ref = "ktor" }
ktor-serialization-kotlinx-json = { group = "io.ktor", name = "ktor-serialization-kotlinx-json", version.ref = "ktor" }
ktor-client-logging = { group = "io.ktor", name = "ktor-client-logging", version.ref = "ktor" }
ktor-client-mock = { group = "io.ktor", name = "ktor-client-mock", version.ref = "ktor" }
```

`ktor-client-okhttp` is the engine. `ktor-client-android` (HttpURLConnection) would save a dependency, but OkHttp's connection pooling and timeout behaviour are the ones people debug for years; an APK of 13.5 MB does not need the kilobytes saved.

- [ ] **Step 2: Add the INTERNET permission**

In `Android/app/src/main/AndroidManifest.xml`, add inside `<manifest>` before `<application>`:
```xml
    <uses-permission android:name="android.permission.INTERNET" />
```

This is the only permission the feature needs, and it is a normal permission granted at install with no prompt.

- [ ] **Step 3: Add the debug-only cleartext config**

Create `Android/app/src/debug/res/xml/network_security_config.xml`:
```xml
<?xml version="1.0" encoding="utf-8"?>
<!--
  Debug builds only. targetSdk 37 blocks cleartext by default, and a development
  server on the developer's machine is plain HTTP.

  The emulator reaches the host machine at 10.0.2.2, so that is the address
  allowlisted below. Nothing here reaches the release build: the release variant
  declares no networkSecurityConfig at all.
-->
<network-security-config>
    <domain-config cleartextTrafficPermitted="true">
        <domain includeSubdomains="false">10.0.2.2</domain>
        <domain includeSubdomains="false">localhost</domain>
        <domain includeSubdomains="false">127.0.0.1</domain>
    </domain-config>
</network-security-config>
```

Create `Android/app/src/debug/AndroidManifest.xml`:
```xml
<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android"
    xmlns:tools="http://schemas.android.com/tools">
    <application
        android:networkSecurityConfig="@xml/network_security_config"
        tools:replace="android:networkSecurityConfig" />
</manifest>
```

`tools:replace` is required because the debug overlay merges into the already-declared
`<application>` element.

- [ ] **Step 4: Add the server URL as a build config field**

In `Android/app/build.gradle.kts`, inside `android { defaultConfig { … } }` add:
```kotlin
        // 10.0.2.2 is how the Android emulator reaches the host machine's
        // localhost. Override per machine with -PbillkitServerUrl=https://…
        val serverUrl = (project.findProperty("billkitServerUrl") as String?)
            ?: "http://10.0.2.2:4000"
        buildConfigField("String", "SERVER_URL", "\"$serverUrl\"")
```
and inside `android { }` add:
```kotlin
    buildFeatures {
        buildConfig = true
    }
```

The property name is `billkitServerUrl`, referenced once here and once in Task 6 Step 3. Keep
the two spellings identical — a typo here produces a silently ignored `-P` flag and a device
that still talks to the default address.

- [ ] **Step 5: Write the failing test**

Create `Android/app/src/test/kotlin/com/billkit/host/BuildConfigTest.kt`:
```kotlin
package com.billkit.host

import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class BuildConfigTest {
    @Test
    fun `the server url is compiled in and absolute`() {
        assertTrue(
            BuildConfig.SERVER_URL.startsWith("http://") || BuildConfig.SERVER_URL.startsWith("https://"),
            "SERVER_URL must be absolute, was ${BuildConfig.SERVER_URL}",
        )
    }
}
```

`app` currently has no `testImplementation` for JUnit 5. Add to `Android/app/build.gradle.kts`:
```kotlin
    testImplementation(libs.junit.jupiter)
    testRuntimeOnly(libs.junit.platform.launcher)
```

- [ ] **Step 6: Run it**

```powershell
.\gradlew.bat --no-configuration-cache :app:testDebugUnitTest --tests "*BuildConfigTest*"
```
Expected: PASS. Steps 2-4 already enabled `buildConfig` and added the field, so this test
confirms the field reached the compiled manifest rather than failing first. The genuine
negative proof for this task is Step 8, which fails if the cleartext config leaks into
release.

- [ ] **Step 7: Confirm the release build has no cleartext config**

```powershell
.\gradlew.bat --no-configuration-cache :app:processReleaseMainManifest --dry-run
.\gradlew.bat --no-configuration-cache :app:assembleDebug
```
Expected: assembleDebug succeeds. Then confirm the release manifest has no networkSecurityConfig:
```powershell
Select-String -Path "app\build\intermediates\merged_manifest\release\processReleaseMainManifest\AndroidManifest.xml" -Pattern "networkSecurityConfig"
```
Expected: **no match**. If it matches, the config has leaked out of `src/debug`.

- [ ] **Step 8: Commit**

The Android tree is not a git repository, so there is nothing to commit. Record progress in
the plan instead and confirm the whole tree still builds:
```powershell
.\gradlew.bat --no-configuration-cache assembleDebug testDebugUnitTest lintDebug
```
Expected: green, 21 tests.

---

### Task 2: `feature:templates:domain` and the new error vocabulary

**Files:**
- Create: `Android/feature/templates/domain/build.gradle.kts`
- Create: `Android/feature/templates/domain/src/main/kotlin/com/billkit/feature/templates/domain/TemplateCatalogItem.kt`
- Create: `Android/feature/templates/domain/src/main/kotlin/com/billkit/feature/templates/domain/TemplateStore.kt`
- Create: `Android/feature/templates/domain/src/main/kotlin/com/billkit/feature/templates/domain/TemplateRemoteSource.kt`
- Create: `Android/feature/templates/domain/src/main/kotlin/com/billkit/feature/templates/domain/TemplateRepository.kt`
- Modify: `Android/settings.gradle.kts`
- Modify: `Android/core/domain/src/main/kotlin/com/billkit/core/domain/DataError.kt`
- Modify: `Android/core/presentation/src/main/res/values/strings.xml`
- Modify: `Android/core/presentation/src/main/kotlin/com/billkit/core/presentation/DataErrorUiText.kt`
- Test: `Android/feature/templates/domain/src/test/kotlin/com/billkit/feature/templates/domain/TemplateRepositoryTest.kt`

**Interfaces:**
- Consumes: `Result<T, DataError>` from `:core:domain`.
- Produces:
  - `data class TemplateCatalogItem(id, name, description, filename, byteSize, pageWidth, pageHeight, fieldCount, assetCount, uploadedAt)`
  - `data class LocalTemplate(id, name, byteSize, downloadedAt)`
  - `interface TemplateRemoteSource { suspend fun catalog(baseUrl: String): Result<List<TemplateCatalogItem>, DataError>; suspend fun download(baseUrl: String, id: String): Result<ByteArray, DataError> }`
  - `interface TemplateStore { suspend fun list(): List<LocalTemplate>; suspend fun save(item, bytes): Result<Unit, DataError>; suspend fun read(id): Result<ByteArray?, DataError>; suspend fun delete(id): Result<Unit, DataError> }`
  - `class TemplateRepository(remote, store, baseUrl)` with `refresh()`, `download(item)`, `openBytes(id)`
  - New `DataError` cases: `NetworkUnavailable`, `HttpError(code)`, `CatalogUnreadable`, `DownloadCorrupt`, `StorageFailed`

- [ ] **Step 1: Register the module**

In `Android/settings.gradle.kts`, after the renderer includes:
```kotlin
include(":feature:templates:domain")
```

- [ ] **Step 2: Create the domain build file**

Create `Android/feature/templates/domain/build.gradle.kts`:
```kotlin
plugins {
    id("billkit.jvm.library")
}

dependencies {
    // The only module a feature's domain may depend on.
    implementation(project(":core:domain"))

    testImplementation(libs.junit.jupiter)
    testImplementation(libs.assertk)
    testImplementation(libs.kotlinx.coroutines.test)
    testRuntimeOnly(libs.junit.platform.launcher)
}
```

`billkit.jvm.library` does not bring the test stack (that is `billkit.feature`), so it is
listed explicitly here — the same thing `feature/renderer/domain` does.

- [ ] **Step 3: Add the DataError cases**

Replace the sealed interface in `DataError.kt` with:
```kotlin
sealed interface DataError : Error {
    /** The archive could not be opened at all. */
    data object Unreadable : DataError

    /** The archive opened, but the manifest is absent or not JSON. */
    data object ManifestUnreadable : DataError

    /** The archive opened, but the template document is absent or not JSON. */
    data object TemplateUnreadable : DataError

    /** A `pkg://` reference points at no asset in the archive. */
    data class UnresolvedAsset(val path: String) : DataError

    /** The runtime in the WebView could not produce a page. */
    data object RenderFailed : DataError

    /** The device could not reach the template server at all. */
    data object NetworkUnavailable : DataError

    /** The server answered, but not with success. */
    data class HttpError(val code: Int) : DataError

    /** The server answered with something that is not a catalog. */
    data object CatalogUnreadable : DataError

    /** The bytes arrived, but do not match the digest the catalog promised. */
    data object DownloadCorrupt : DataError

    /** Local storage refused the write. */
    data object StorageFailed : DataError

    /** Anything that does not fit the above. */
    data object Unknown : DataError
}
```

Also update that file's KDoc: the sentence "There is no network in this host" is no longer
true once Task 5 lands, and leaving it would be a lie in the one file that defines the app's
failure vocabulary.

- [ ] **Step 4: Add the strings**

Append to `Android/core/presentation/src/main/res/values/strings.xml` before `</resources>`:
```xml
    <string name="error_network_unavailable">Could not reach the template server.</string>
    <string name="error_http">The template server answered with an error (%1$d).</string>
    <string name="error_catalog_unreadable">The template list could not be read.</string>
    <string name="error_download_corrupt">That download did not match what the server promised, so it was discarded.</string>
    <string name="error_storage_failed">This device could not save the template.</string>
```

- [ ] **Step 5: Extend the UiText mapping**

In `DataErrorUiText.kt`, add to the `when`:
```kotlin
        DataError.NetworkUnavailable -> UiText.StringResource(R.string.error_network_unavailable)
        is DataError.HttpError -> UiText.StringResource(R.string.error_http, code)
        DataError.CatalogUnreadable -> UiText.StringResource(R.string.error_catalog_unreadable)
        DataError.DownloadCorrupt -> UiText.StringResource(R.string.error_download_corrupt)
        DataError.StorageFailed -> UiText.StringResource(R.string.error_storage_failed)
```

Add to `core/presentation/build.gradle.kts` nothing — it already has serialization. If the
compiler complains that `R.string.error_http` needs the format argument, check `UiText.StringResource`
already carries `vararg formatArgs`.

- [ ] **Step 6: Write the domain models**

`TemplateCatalogItem.kt`:
```kotlin
package com.billkit.feature.templates.domain

/** One row of `GET /api/packages`, as the server publishes it. */
data class TemplateCatalogItem(
    val id: String,
    val name: String,
    val description: String?,
    val filename: String,
    val byteSize: Long,
    val pageWidth: Int?,
    val pageHeight: Int?,
    val fieldCount: Int?,
    val assetCount: Int?,
    val uploadedAt: String,
)
```

`TemplateStore.kt`:
```kotlin
package com.billkit.feature.templates.domain

import com.billkit.core.domain.DataError
import com.billkit.core.domain.Result

/** A package this device already holds. */
data class LocalTemplate(
    val id: String,
    val name: String,
    val byteSize: Long,
    val downloadedAt: String,
)

/**
 * Where downloaded packages live.
 *
 * [read] returns `null` for a package that is simply not here, which is a normal
 * answer rather than a failure: a caller asking about an unknown id wants to know
 * it is absent, not that something went wrong.
 */
interface TemplateStore {
    suspend fun list(): List<LocalTemplate>
    suspend fun save(item: TemplateCatalogItem, bytes: ByteArray): Result<Unit, DataError>
    suspend fun read(id: String): Result<ByteArray?, DataError>
    suspend fun delete(id: String): Result<Unit, DataError>
}
```

`TemplateRemoteSource.kt`:
```kotlin
package com.billkit.feature.templates.domain

import com.billkit.core.domain.DataError
import com.billkit.core.domain.Result

/** The two server calls this feature makes. Both are unauthenticated. */
interface TemplateRemoteSource {
    suspend fun catalog(baseUrl: String): Result<List<TemplateCatalogItem>, DataError>
    suspend fun download(baseUrl: String, id: String): Result<ByteArray, DataError>
}
```

- [ ] **Step 7: Write the repository with verification built in**

`TemplateRepository.kt`:
```kotlin
package com.billkit.feature.templates.domain

import com.billkit.core.domain.DataError
import com.billkit.core.domain.Result
import java.security.MessageDigest

/**
 * Pairs the server with local storage.
 *
 * The verification lives here rather than in the store because this is the only
 * point where both halves are known: the catalog promised a digest, the bytes
 * arrived, and only here can the two be compared.
 */
class TemplateRepository(
    private val remote: TemplateRemoteSource,
    private val store: TemplateStore,
    private val baseUrl: String,
) {
    suspend fun refresh(): Result<List<TemplateCatalogItem>, DataError> = remote.catalog(baseUrl)

    suspend fun download(item: TemplateCatalogItem): Result<LocalTemplate, DataError> =
        when (val fetched = remote.download(baseUrl, item.id)) {
            is Result.Error -> fetched
            is Result.Success -> {
                val bytes = fetched.value
                when (val verified = verify(item.id, bytes)) {
                    is Result.Error -> verified
                    is Result.Success -> when (val saved = store.save(item, bytes)) {
                        is Result.Error -> saved
                        is Result.Success -> saved.value
                    }
                }
            }
        }

    /** The stored bytes for [id], or `null` when this device does not have them. */
    suspend fun openBytes(id: String): Result<ByteArray?, DataError> = store.read(id)

    suspend fun stored(): Result<List<LocalTemplate>, DataError> = store.list()

    suspend fun forget(id: String): Result<Unit, DataError> = store.delete(id)

    companion object {
        /**
         * The catalog id IS the sha256 of the package bytes, so this one digest
         * covers the whole archive - every member, and the manifest digest
         * beside it. Checking it subsumes the per-member checksums rather than
         * adding to them.
         */
        fun verify(expectedId: String, bytes: ByteArray): Result<Unit, DataError> {
            val digest = MessageDigest.getInstance("SHA-256").digest(bytes)
                .joinToString("") { "%02x".format(it) }
            return if (digest == expectedId) {
                Result.Success(Unit)
            } else {
                Result.Error(DataError.DownloadCorrupt)
            }
        }
    }
}
```

- [ ] **Step 8: Write the failing repository test**

Create `TemplateRepositoryTest.kt`:
```kotlin
package com.billkit.feature.templates.domain

import assertk.assertThat
import assertk.assertions.isEmpty
import assertk.assertions.isEqualTo
import assertk.assertions.isFalse
import assertk.assertions.isNull
import com.billkit.core.domain.DataError
import com.billkit.core.domain.Result
import kotlinx.coroutines.test.runTest
import org.junit.jupiter.api.Test

class TemplateRepositoryTest {

    private fun item(id: String = "a".repeat(64), name: String = "Bill") = TemplateCatalogItem(
        id = id, name = name, description = null, filename = "bill.btpkg",
        byteSize = 3, pageWidth = 794, pageHeight = 1123, fieldCount = 4, assetCount = 0,
        uploadedAt = "2026-10-12T00:00:00.000Z",
    )

    private class FakeRemote(
        var catalogResult: Result<List<TemplateCatalogItem>, DataError> = Result.Success(emptyList()),
        var downloadResult: Result<ByteArray, DataError> = Result.Success(ByteArray(0)),
    ) : TemplateRemoteSource {
        var downloadCalls = 0
        override suspend fun catalog(baseUrl: String) = catalogResult
        override suspend fun download(baseUrl: String, id: String): Result<ByteArray, DataError> {
            downloadCalls++
            return downloadResult
        }
    }

    private class FakeStore : TemplateStore {
        val saved = mutableMapOf<String, ByteArray>()
        override suspend fun list(): List<LocalTemplate> =
            saved.map { (id, b) -> LocalTemplate(id, id, b.size.toLong(), "2026-10-12T00:00:00.000Z") }
        override suspend fun save(item: TemplateCatalogItem, bytes: ByteArray) =
            Result.Success(saved.put(item.id, bytes))
        override suspend fun read(id: String) = Result.Success(saved[id])
        override suspend fun delete(id: String) = Result.Success(saved.remove(id))
    }

    private val goodBytes = ByteArray(0).also {
        // sha256 of an empty array
        val d = java.security.MessageDigest.getInstance("SHA-256").digest(it)
        val hex = d.joinToString("") { b -> "%02x".format(b) }
    }

    @Test
    fun `a download matching the catalog digest is stored`() = runTest {
        val id = TemplateRepository.verify(
            "a".repeat(64),
            ByteArray(0),
        )
        assertThat(id.isSuccess()).isFalse()

        val remote = FakeRemote(downloadResult = Result.Success(ByteArray(0)))
        val store = FakeStore()
        val realId = digestOf(ByteArray(0))
        val repo = TemplateRepository(remote, store, "http://host")

        val result = repo.download(item(realId))

        assertThat(result.isSuccess()).isTrue()
        assertThat(store.saved.keys).isEqualTo(setOf(realId))
    }

    @Test
    fun `a download that does not match the digest is discarded, not stored`() = runTest {
        val store = FakeStore()
        val repo = TemplateRepository(FakeRemote(downloadResult = Result.Success(ByteArray(9, 7))), store, "http://host")

        val result = repo.download(item("b".repeat(64)))

        assertThat(result.isError()).isTrue()
        assertThat((result as Result.Error).error).isEqualTo(DataError.DownloadCorrupt)
        assertThat(store.saved).isEmpty()
    }

    @Test
    fun `a failed download never reaches the store`() = runTest {
        val store = FakeStore()
        val repo = TemplateRepository(FakeRemote(downloadResult = Result.Error(DataError.NetworkUnavailable)), store, "http://host")

        val result = repo.download(item())

        assertThat((result as Result.Error).error).isEqualTo(DataError.NetworkUnavailable)
        assertThat(store.saved).isEmpty()
    }

    @Test
    fun `openBytes reports an unknown id as absent rather than failed`() = runTest {
        val repo = TemplateRepository(FakeRemote(), FakeStore(), "http://host")
        val result = repo.openBytes("c".repeat(64))
        assertThat((result as Result.Success).value).isNull()
    }

    @Test
    fun `a stored package can be forgotten`() = runTest {
        val store = FakeStore()
        val id = digestOf(ByteArray(0))
        val repo = TemplateRepository(FakeRemote(), store, "http://host")
        repo.download(item(id))
        repo.forget(id)
        assertThat(repo.openBytes(id).let { (it as Result.Success).value }).isNull()
    }

    private fun digestOf(bytes: ByteArray): String =
        java.security.MessageDigest.getInstance("SHA-256").digest(bytes)
            .joinToString("") { b -> "%02x".format(b) }
}
```

- [ ] **Step 9: Run the test**

```powershell
.\gradlew.bat --no-configuration-cache :feature:templates:domain:test
```
Expected: 5 passed.

If the first test's shape is awkward to read, that is a signal the fixture is doing too much:
replace the two-line `goodBytes`/`verify` preamble with a direct call to the private
`digestOf` helper, which is what the other tests already use.

- [ ] **Step 10: Run the gate**

```powershell
.\gradlew.bat --no-configuration-cache assembleDebug testDebugUnitTest lintDebug
```
Expected: green. `DataErrorUiText` now compiles against the new cases, so a missing `when`
branch would fail here rather than at runtime.

---

### Task 3: `feature:templates:data` — Ktor client and file store

**Files:**
- Create: `Android/feature/templates/data/build.gradle.kts`
- Create: `.../data/src/main/kotlin/com/billkit/feature/templates/data/CatalogDto.kt`
- Create: `.../data/src/main/kotlin/com/billkit/feature/templates/data/KtorTemplateRemoteSource.kt`
- Create: `.../data/src/main/kotlin/com/billkit/feature/templates/data/FileTemplateStore.kt`
- Create: `.../data/src/main/kotlin/com/billkit/feature/templates/data/TemplatesDataModule.kt`
- Modify: `Android/settings.gradle.kts`
- Test: `.../data/src/test/kotlin/.../KtorTemplateRemoteSourceTest.kt`
- Test: `.../data/src/test/kotlin/.../FileTemplateStoreTest.kt`

**Interfaces:**
- Consumes: domain interfaces from Task 2; `libs.ktor.*`.
- Produces: `KtorTemplateRemoteSource(client, json)`, `FileTemplateStore(dir: File)`, `templatesDataModule`.

- [ ] **Step 1: Register the module and create its build file**

Add to `Android/settings.gradle.kts`:
```kotlin
include(":feature:templates:data")
```

Create `Android/feature/templates/data/build.gradle.kts`:
```kotlin
plugins {
    id("billkit.android.library")
    id("billkit.serialization")
}

android {
    namespace = "com.billkit.feature.templates.data"
}

dependencies {
    implementation(project(":feature:templates:domain"))
    implementation(project(":core:domain"))

    implementation(libs.kotlinx.coroutines.core)
    implementation(libs.kotlinx.serialization.json)
    implementation(libs.ktor.client.core)
    implementation(libs.ktor.client.okhttp)
    implementation(libs.ktor.client.content.negotiation)
    implementation(libs.ktor.serialization.kotlinx.json)
    implementation(libs.ktor.client.logging)
    implementation(libs.koin.core)

    testImplementation(libs.junit.jupiter)
    testImplementation(libs.assertk)
    testImplementation(libs.kotlinx.coroutines.test)
    testImplementation(libs.ktor.client.mock)
    testRuntimeOnly(libs.junit.platform.launcher)
}
```

- [ ] **Step 2: Write the DTOs**

Create `CatalogDto.kt`:
```kotlin
package com.billkit.feature.templates.data

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

@Serializable
internal data class CatalogItemDto(
    val id: String,
    val name: String,
    val description: String? = null,
    val filename: String = "package.btpkg",
    val byteSize: Long = 0,
    val page: PageDto = PageDto(),
    val fieldCount: Int? = null,
    val assetCount: Int? = null,
    val uploadedAt: String = "",
)

@Serializable
internal data class PageDto(
    val width: Int? = null,
    val height: Int? = null,
)

@Serializable
internal data class UploadResultDto(
    @SerialName("error") val error: String? = null,
    @SerialName("issues") val issues: List<IssueDto> = emptyList(),
)

@Serializable
internal data class IssueDto(
    val severity: String = "error",
    val path: String = "",
    val message: String = "",
)
```

Every field has a default so a server that grows or shrinks the payload does not make the
device fail to list anything.

- [ ] **Step 3: Write the Ktor remote source**

Create `KtorTemplateRemoteSource.kt`:
```kotlin
package com.billkit.feature.templates.data

import android.util.Log
import com.billkit.core.domain.DataError
import com.billkit.core.domain.Result
import com.billkit.feature.templates.domain.TemplateCatalogItem
import com.billkit.feature.templates.domain.TemplateRemoteSource
import io.ktor.client.HttpClient
import io.ktor.client.call.body
import io.ktor.client.request.get
import io.ktor.client.statement.bodyAsBytes
import io.ktor.http.HttpStatusCode
import kotlinx.serialization.json.Json

private const val TAG = "BillKitNetwork"

/**
 * The only place the app talks to the template server.
 *
 * The server publishes no auth, so there is no credential to attach and nothing
 * to refresh.
 */
internal class KtorTemplateRemoteSource(
    private val client: HttpClient,
    private val json: Json,
) : TemplateRemoteSource {

    override suspend fun catalog(baseUrl: String): Result<List<TemplateCatalogItem>, DataError> =
        guard("catalog") {
            val dtos: List<CatalogItemDto> = client.get("${baseUrl.trimEnd('/')}/api/packages").body()
            dtos.map { dto ->
                TemplateCatalogItem(
                    id = dto.id,
                    name = dto.name,
                    description = dto.description,
                    filename = dto.filename,
                    byteSize = dto.byteSize,
                    pageWidth = dto.page.width,
                    pageHeight = dto.page.height,
                    fieldCount = dto.fieldCount,
                    assetCount = dto.assetCount,
                    uploadedAt = dto.uploadedAt,
                )
            }
        }

    override suspend fun download(baseUrl: String, id: String): Result<ByteArray, DataError> =
        guard("download") {
            val response = client.get("${baseUrl.trimEnd('/')}/api/packages/$id/download")
            if (response.status != HttpStatusCode.OK) {
                return@guard Result.Error(DataError.HttpError(response.status.value))
            }
            // Downloaded whole before anything touches disk. The repository
            // verifies the digest of these exact bytes before saving them.
            response.bodyAsBytes()
        }

    private suspend inline fun <T> guard(
        what: String,
        block: () -> Result<T, DataError>,
    ): Result<T, DataError> =
        try {
            block()
        } catch (e: kotlinx.coroutines.CancellationException) {
            throw e
        } catch (e: Throwable) {
            Log.w(TAG, "$what failed", e)
            Result.Error(
                if (e is kotlinx.io.IOException) DataError.NetworkUnavailable else DataError.CatalogUnreadable,
            )
        }
}
```

The `CancellationException` rethrow is not optional: swallowing it breaks structured
concurrency and leaves a cancelled screen's download running.

- [ ] **Step 4: Write the failing remote-source test with MockEngine**

Create `KtorTemplateRemoteSourceTest.kt`:
```kotlin
package com.billkit.feature.templates.data

import assertk.assertThat
import assertk.assertions.hasSize
import assertk.assertions.isEqualTo
import com.billkit.core.domain.DataError
import com.billkit.core.domain.Result
import io.ktor.client.HttpClient
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.client.engine.mock.respondError
import io.ktor.client.plugins.contentnegotiation.ContentNegotiation
import io.ktor.http.ContentType
import io.ktor.http.HttpHeaders
import io.ktor.http.headersOf
import io.ktor.serialization.kotlinx.json.json
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.Json
import org.junit.jupiter.api.Test

class KtorTemplateRemoteSourceTest {

    private fun client(engine: MockEngine) = HttpClient(engine) {
        expectSuccess = false
        install(ContentNegotiation) { json(Json { ignoreUnknownKeys = true }) }
    }

    private val json = Json { ignoreUnknownKeys = true }

    @Test
    fun `maps a catalog response`() = runTest {
        val engine = MockEngine {
            respond(
                content = """[{"id":"${"a".repeat(64)}","name":"Night Bill","description":"d",
                  "filename":"n.btpkg","byteSize":10,"page":{"width":794,"height":1123},
                  "fieldCount":4,"assetCount":1,"uploadedAt":"2026-10-12T00:00:00.000Z"}]""",
                status = io.ktor.http.HttpStatusCode.OK,
                headers = headersOf(HttpHeaders.ContentType, ContentType.Application.Json.toString()),
            )
        }
        val source = KtorTemplateRemoteSource(client(engine), json)

        val result = source.catalog("http://host/")

        assertThat((result as Result.Success).value).hasSize(1)
        assertThat(result.value[0].name).isEqualTo("Night Bill")
        assertThat(result.value[0].pageWidth).isEqualTo(794)
    }

    @Test
    fun `tolerates a catalog missing optional fields`() = runTest {
        val engine = MockEngine {
            respond("""[{"id":"b","name":"Sparse"}]""",
                headers = headersOf(HttpHeaders.ContentType, ContentType.Application.Json.toString()))
        }
        val result = KtorTemplateRemoteSource(client(engine), json).catalog("http://host")
        assertThat((result as Result.Success).value).hasSize(1)
    }

    @Test
    fun `maps a download error status to HttpError`() = runTest {
        val engine = MockEngine { respondError(io.ktor.http.HttpStatusCode.NotFound) }
        val result = KtorTemplateRemoteSource(client(engine), json)
            .download("http://host", "a".repeat(64))
        assertThat((result as Result.Error).error)
            .isEqualTo(DataError.HttpError(404))
    }

    @Test
    fun `returns the downloaded bytes`() = runTest {
        val payload = byteArrayOf(1, 2, 3)
        val engine = MockEngine {
            respond(payload, headers = headersOf(HttpHeaders.ContentType, ContentType.Application.OctetStream.toString()))
        }
        val result = KtorTemplateRemoteSource(client(engine), json).download("http://host", "x")
        assertThat((result as Result.Success).value).isEqualTo(payload)
    }

    @Test
    fun `a dead server becomes NetworkUnavailable, not a crash`() = runTest {
        val engine = MockEngine { throw java.io.IOException("no route to host") }
        val result = KtorTemplateRemoteSource(client(engine), json).catalog("http://host")
        assertThat(result.isError()).isEqualTo(true)
    }
}
```

- [ ] **Step 5: Run it to confirm it fails, then passes**

```powershell
.\gradlew.bat --no-configuration-cache :feature:templates:data:test --tests "*KtorTemplateRemoteSourceTest*"
```
Expected: first run fails on a missing symbol; after Step 3, 5 passed.

If the IOException case reports `CatalogUnreadable`, Ktor wrapped it as something else —
change the guard's check to `e.cause is java.io.IOException || e is java.io.IOException`
rather than weakening the test.

- [ ] **Step 6: Write the failing file-store test**

Create `FileTemplateStoreTest.kt`:
```kotlin
package com.billkit.feature.templates.data

import assertk.assertThat
import assertk.assertions.containsExactly
import assertk.assertions.isEmpty
import assertk.assertions.isNull
import com.billkit.core.domain.DataError
import com.billkit.core.domain.Result
import com.billkit.feature.templates.domain.TemplateCatalogItem
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.Json
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.io.TempDir
import java.io.File

class FileTemplateStoreTest {

    private fun item(id: String) = TemplateCatalogItem(
        id = id, name = "Bill $id", description = null, filename = "b.btpkg",
        byteSize = 3, pageWidth = null, pageHeight = null, fieldCount = 1,
        assetCount = 0, uploadedAt = "2026-10-12T00:00:00.000Z",
    )

    private val json = Json { ignoreUnknownKeys = true; encodeDefaults = true }

    @Test
    fun `saves, lists, reads and deletes`(@TempDir dir: File) = runTest {
        val store = FileTemplateStore(dir, json)
        val id = "d".repeat(64)

        assertThat(store.list()).isEmpty()

        store.save(item(id), byteArrayOf(1, 2, 3))
        val listed = store.list()
        assertThat(listed).containsExactly(
            LocalTemplateAlias(id, "Bill $id", 3, listed[0].downloadedAt),
        )

        assertThat((store.read(id) as Result.Success).value).isEqualTo(byteArrayOf(1, 2, 3))
        store.delete(id)
        assertThat((store.read(id) as Result.Success).value).isNull()
        assertThat(store.list()).isEmpty()
    }

    @Test
    fun `a bad id is refused instead of touching the filesystem`(@TempDir dir: File) = runTest {
        val store = FileTemplateStore(dir, json)
        val result = store.read("../../etc/passwd")
        assertThat((result as Result.Error).error).isEqualTo(DataError.StorageFailed)
    }

    @Test
    fun `a corrupt index does not stop the store from working`(@TempDir dir: File) = runTest {
        val store = FileTemplateStore(dir, json)
        store.save(item("e".repeat(64)), byteArrayOf(9))
        File(dir, "index.json").writeText("{ not json at all")
        assertThat(store.list()).isEmpty()
        // still usable afterwards
        assertThat(store.save(item("f".repeat(64)), byteArrayOf(1)).isSuccess()).isEqualTo(true)
    }

    @Test
    fun `a package on disk with no index entry is not listed`(@TempDir dir: File) = runTest {
        File(dir, "${"9".repeat(64)}.btpkg").writeBytes(byteArrayOf(1))
        assertThat(FileTemplateStore(dir, json).list()).isEmpty()
    }

    @Test
    fun `reading a package whose file vanished reports absent, not failed`(@TempDir dir: File) = runTest {
        val store = FileTemplateStore(dir, json)
        store.save(item("1".repeat(64)), byteArrayOf(1))
        File(dir, "${"1".repeat(64)}.btpkg").delete()
        assertThat((store.read("1".repeat(64)) as Result.Success).value).isNull()
    }

    private fun LocalTemplateAlias(id: String, name: String, size: Int, at: String) =
        com.billkit.feature.templates.domain.LocalTemplate(id, name, size.toLong(), at)
}
```

- [ ] **Step 7: Write FileTemplateStore**

Create `FileTemplateStore.kt`:
```kotlin
package com.billkit.feature.templates.data

import com.billkit.core.domain.DataError
import com.billkit.core.domain.Result
import com.billkit.feature.templates.domain.LocalTemplate
import com.billkit.feature.templates.domain.TemplateCatalogItem
import com.billkit.feature.templates.domain.TemplateStore
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import java.io.File

private val ID = Regex("^[0-9a-f]{64}$")

@Serializable
internal data class StoredTemplate(
    val id: String,
    val name: String,
    val byteSize: Long,
    val downloadedAt: String,
)

/**
 * Downloaded packages on disk, plus a small JSON index describing them.
 *
 * Takes a [File] rather than a Context so it is testable on the JVM; the DI module
 * hands it `File(context.filesDir, "templates")`.
 *
 * The index is rewritten whole on every change, via a temporary file and a
 * rename, so a process death mid-write cannot leave a half-written index that
 * hides every stored package.
 */
internal class FileTemplateStore(
    private val dir: File,
    private val json: Json,
) : TemplateStore {

    private fun indexFile() = File(dir, "index.json")

    private fun readIndex(): List<StoredTemplate> {
        val f = indexFile()
        if (!f.exists()) return emptyList()
        return try {
            json.decodeFromString<List<StoredTemplate>>(f.readText())
        } catch (e: Exception) {
            // A damaged index loses the labels, not the packages: the .btpkg
            // files are still on disk and a re-download repairs the index.
            emptyList()
        }
    }

    private fun writeIndex(entries: List<StoredTemplate>) {
        dir.mkdirs()
        val tmp = File(dir, "index.json.tmp")
        tmp.writeText(json.encodeToString(entries))
        if (!tmp.renameTo(indexFile())) {
            tmp.delete()
            throw IllegalStateException("could not replace the template index")
        }
    }

    private fun fileFor(id: String): File? =
        if (ID.matches(id)) File(dir, "$id.btpkg") else null

    override suspend fun list(): List<LocalTemplate> =
        readIndex().filter { fileFor(it.id)?.exists() == true }
            .map { LocalTemplate(it.id, it.name, it.byteSize, it.downloadedAt) }

    override suspend fun save(item: TemplateCatalogItem, bytes: ByteArray): Result<Unit, DataError> =
        try {
            dir.mkdirs()
            val target = fileFor(item.id) ?: throw IllegalArgumentException("bad id ${item.id}")
            // Write-then-rename so a failed download never leaves a partial
            // archive that later reads as a valid, truncated package.
            val tmp = File(dir, "${item.id}.part")
            tmp.writeBytes(bytes)
            if (!tmp.renameTo(target)) throw IllegalStateException("rename failed")
            writeIndex(readIndex().filterNot { it.id == item.id } + StoredTemplate(
                id = item.id,
                name = item.name,
                byteSize = bytes.size.toLong(),
                downloadedAt = java.time.Instant.now().toString(),
            ))
            Result.Success(Unit)
        } catch (e: kotlinx.coroutines.CancellationException) {
            throw e
        } catch (e: Exception) {
            Result.Error(DataError.StorageFailed)
        }

    override suspend fun read(id: String): Result<ByteArray?, DataError> {
        val f = fileFor(id) ?: return Result.Error(DataError.StorageFailed)
        if (!f.exists()) return Result.Success(null)
        return try {
            Result.Success(f.readBytes())
        } catch (e: Exception) {
            Result.Error(DataError.StorageFailed)
        }
    }

    override suspend fun delete(id: String): Result<Unit, DataError> = try {
        fileFor(id)?.delete()
        writeIndex(readIndex().filterNot { it.id == id })
        Result.Success(Unit)
    } catch (e: Exception) {
        Result.Error(DataError.StorageFailed)
    }
}
```

`java.time.Instant` needs API 26 and `minSdk` is 24. Replace it with
`java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'")` applied in UTC, or add a
`core:desugaring` dependency. The former is a one-line change and avoids the dependency.

- [ ] **Step 8: Write the Koin module**

Create `TemplatesDataModule.kt`:
```kotlin
package com.billkit.feature.templates.data

import com.billkit.feature.templates.domain.TemplateRemoteSource
import com.billkit.feature.templates.domain.TemplateRepository
import com.billkit.feature.templates.domain.TemplateStore
import io.ktor.client.HttpClient
import io.ktor.client.engine.okhttp.OkHttp
import io.ktor.client.plugins.contentnegotiation.ContentNegotiation
import io.ktor.client.plugins.logging.LogLevel
import io.ktor.client.plugins.logging.Logging
import io.ktor.serialization.kotlinx.json.json
import kotlinx.serialization.json.Json
import org.koin.dsl.module
import java.io.File

val templatesDataModule = module {
    // `single<T> { }`, not `singleOf(::…)`: the latter does not resolve from a
    // plain library module in this Koin release.
    single { Json { ignoreUnknownKeys = true; encodeDefaults = true } }

    single {
        HttpClient(OkHttp) {
            expectSuccess = false
            install(ContentNegotiation) { json(get()) }
            install(Logging) { level = LogLevel.INFO }
            // Long enough for a 600 KB package over a slow link, short enough
            // that a dead server surfaces as an error rather than a spinner.
            engine { connectTimeout = 10_000 }
        }
    }

    // The explicit type is load-bearing: an unqualified `get()` here infers this
    // very definition and Koin recurses until the stack overflows.
    single<TemplateRemoteSource> { KtorTemplateRemoteSource(get(), get()) }

    single<TemplateStore> {
        FileTemplateStore(File(androidApplication().filesDir, "templates"), get())
    }
}
```

`androidApplication()` is from `org.koin.android.ext.koin.androidApplication`; add that import.

- [ ] **Step 9: Run the data tests and the gate**

```powershell
.\gradlew.bat --no-configuration-cache :feature:templates:data:test
.\gradlew.bat --no-configuration-cache assembleDebug testDebugUnitTest lintDebug
```
Expected: 5 + 5 data tests pass; whole build green.

---

### Task 4: The renderer accepts a stored template

**Files:**
- Modify: `Android/feature/renderer/presentation/src/main/kotlin/com/billkit/feature/renderer/presentation/RendererViewModel.kt`
- Modify: `.../RendererPresentationModule.kt`
- Modify: `.../RendererNavigation.kt`
- Modify: `Android/feature/renderer/presentation/src/test/kotlin/.../RendererViewModelTest.kt`
- Test: additions to `RendererViewModelTest.kt`

**Interfaces:**
- Consumes: `TemplateRepository.openBytes(id)` from Task 2.
- Produces: `RendererAction.OnOpenStoredTemplate(id)`; `RendererViewModel(... , storedLoader: suspend (String) -> ByteArray?)`; public `rememberRendererViewModel()`.

- [ ] **Step 1: Write the failing tests**

In `RendererViewModelTest.kt`, update the factory to take the new loader and add three tests:
```kotlin
    private fun viewModel(
        reader: PackageReader = FakeReader(),
        runtime: BillKitRuntime = FakeRuntime(),
        stored: ByteArray? = byteArrayOf(4, 5, 6),
    ) = RendererViewModel(
        packageReader = reader,
        runtime = runtime,
        savedStateHandle = SavedStateHandle(),
        sampleLoader = { byteArrayOf(1, 2, 3) },
        storedLoader = { stored },
    )

    @Test
    fun `a stored template opens the document just as the sample does`() = runTest(dispatcher) {
        val reader = FakeReader(result = Result.Success(BillPackage("Stored", BillPackage.PageSize(794, 1123), "{}", "{}")))
        val runtime = FakeRuntime(form = Result.Success(schema))
        val vm = viewModel(reader = reader, runtime = runtime)
        advanceUntilIdle()

        vm.onAction(RendererAction.OnOpenStoredTemplate("a".repeat(64)))
        advanceUntilIdle()

        assertThat(vm.state.value.documentName).isEqualTo("Stored")
        assertThat(vm.state.value.isLoading).isFalse()
        assertThat(runtime.deriveCalls).isEqualTo(1)
    }

    @Test
    fun `opening nothing leaves the error state rather than hanging`() = runTest(dispatcher) {
        val vm = viewModel(stored = null)
        advanceUntilIdle()
        vm.onAction(RendererAction.OnOpenStoredTemplate("missing"))
        advanceUntilIdle()
        assertThat(vm.state.value.error).isNotNull()
    }

    @Test
    fun `the sample is no longer opened on construction`() = runTest(dispatcher) {
        val runtime = FakeRuntime(form = Result.Success(schema))
        val vm = viewModel(runtime = runtime)
        advanceUntilIdle()
        assertThat(runtime.deriveCalls).isEqualTo(0)
        assertThat(vm.state.value.documentName).isNull()
    }
```

Replace the existing `opening the sample loads the document and its form` so it dispatches
explicitly:
```kotlin
    @Test
    fun `opening the sample loads the document and its form`() = runTest(dispatcher) {
        val runtime = FakeRuntime(form = Result.Success(schema))
        val vm = viewModel(runtime = runtime)
        vm.onAction(RendererAction.OnOpenSample)
        advanceUntilIdle()

        assertThat(vm.state.value.documentName).isEqualTo("Bill")
        assertThat(runtime.deriveCalls).isEqualTo(1)
    }
```

- [ ] **Step 2: Run them to confirm they fail**

```powershell
.\gradlew.bat --no-configuration-cache :feature:renderer:presentation:test
```
Expected: compile failure — `storedLoader` and `OnOpenStoredTemplate` do not exist yet.

- [ ] **Step 3: Add the action and the loader**

In `RendererViewModel.kt`, add to `RendererAction`:
```kotlin
    /** Open a package this device already holds, by catalog id. */
    data class OnOpenStoredTemplate(val id: String) : RendererAction
```
Add the constructor parameter:
```kotlin
    private val storedLoader: suspend (String) -> ByteArray?,
```
Remove `onAction(RendererAction.OnOpenSample)` from `init`, and replace it with a comment
recording why:
```kotlin
    init {
        // The sample is no longer opened here. Opening it unconditionally meant
        // merely constructing this ViewModel parsed a 600 KB package and loaded
        // the WebView runtime - which is why a Templates screen could not exist
        // without dragging the whole render pipeline along behind it.
        // HomeRoot asks for the sample once it is on screen.
    }
```
Add the handler:
```kotlin
    private suspend fun openStored(id: String) {
        val bytes = storedLoader(id)
        if (bytes == null) {
            onError(RendererError.PackageUnreadable)
            return
        }
        openPackage(bytes)
    }
```
and dispatch it in `onAction`:
```kotlin
            is RendererAction.OnOpenStoredTemplate -> openStored(id)
```
Use whatever the existing private error-reporting helper is called; if there is none, add
`private fun onError(error: RendererError) { _state.update { it.copy(isLoading = false, error = error) } }`.

- [ ] **Step 4: Wire the loader in Koin**

In `RendererPresentationModule.kt`, add a constructor argument to the `RendererViewModel { }`
binding:
```kotlin
            storedLoader = { id ->
                val repository: TemplateRepository = get()
                when (val r = repository.openBytes(id)) {
                    is Result.Success -> r.value
                    is Result.Error -> null
                }
            },
```
and add `implementation(project(":feature:templates:domain"))` to that module's
`build.gradle.kts` plus the imports for `TemplateRepository` and `Result`.

- [ ] **Step 5: Make the shared accessor public**

In `RendererNavigation.kt`, rename the private `sharedViewModel()` to a public
`rememberRendererViewModel()` with `@Composable` and `@JvmName` not needed, and update the
three existing `composable<…>` call sites.

This is what lets `:app` dispatch "open this template" from its own wiring without
`feature:templates` ever importing `feature:renderer`.

- [ ] **Step 6: Make Home ask for the sample, once**

In `HomeRoot`, add:
```kotlin
    // Home is the only place that offers the bundled sample, and only when
    // nothing else is loaded. Keying on Unit means this runs once per entry into
    // the screen; the emptiness check means returning to Home after choosing a
    // downloaded template does not overwrite it with the sample.
    val nothingLoaded = viewModel.state.value.documentName == null
    LaunchedEffect(Unit) {
        if (nothingLoaded) viewModel.onAction(RendererAction.OnOpenSample)
    }
```
Add the `LaunchedEffect` import.

- [ ] **Step 7: Run the renderer tests**

```powershell
.\gradlew.bat --no-configuration-cache :feature:renderer:presentation:test
```
Expected: all pass, including the three new ones.

---

### Task 5: The Templates screen

**Files:**
- Create: `Android/feature/templates/presentation/build.gradle.kts`
- Create: `.../presentation/src/main/kotlin/.../TemplatesViewModel.kt`
- Create: `.../presentation/src/main/kotlin/.../TemplatesScreen.kt`
- Create: `.../presentation/src/main/kotlin/.../TemplatesNavigation.kt`
- Create: `.../presentation/src/main/kotlin/.../TemplatesPresentationModule.kt`
- Create: `.../presentation/src/main/res/values/strings.xml`
- Modify: `Android/settings.gradle.kts`
- Modify: `Android/app/src/main/kotlin/com/billkit/host/App.kt`
- Modify: `Android/app/src/main/kotlin/com/billkit/host/MainActivity.kt`
- Modify: `Android/app/build.gradle.kts`
- Modify: `Android/feature/renderer/presentation/src/main/kotlin/.../HomeScreen.kt`
- Test: `.../presentation/src/test/kotlin/.../TemplatesViewModelTest.kt`

**Interfaces:**
- Consumes: `TemplateRepository` (Task 2/3), `rememberRendererViewModel` (Task 4).
- Produces: `TemplatesRoute`, `templatesGraph(navController, onUseTemplate, onBack)`, `TemplatesViewModel`.

- [ ] **Step 1: Create the module and build file**

Add to `Android/settings.gradle.kts`:
```kotlin
include(":feature:templates:presentation")
```

Create `Android/feature/templates/presentation/build.gradle.kts`:
```kotlin
plugins {
    id("billkit.feature")
}

android {
    namespace = "com.billkit.feature.templates.presentation"
}

dependencies {
    implementation(project(":core:design-system"))
    implementation(project(":core:presentation"))
    implementation(project(":core:domain"))
    implementation(project(":feature:templates:domain"))
    implementation(project(":feature:templates:data"))
    implementation(project(":feature:renderer:domain"))

    implementation(libs.kotlinx.serialization.json)
    implementation(libs.koin.androidx.compose)
}
```

`billkit.feature` brings compose, navigation, lifecycle-viewmodel-compose and the test stack.

- [ ] **Step 2: Write the failing ViewModel test**

Create `TemplatesViewModelTest.kt`:
```kotlin
package com.billkit.feature.templates.presentation

import app.cash.turbine.test
import assertk.assertThat
import assertk.assertions.hasSize
import assertk.assertions.isEmpty
import assertk.assertions.isFalse
import assertk.assertions.isTrue
import com.billkit.core.domain.DataError
import com.billkit.core.domain.Result
import com.billkit.feature.templates.domain.LocalTemplate
import com.billkit.feature.templates.domain.TemplateCatalogItem
import com.billkit.feature.templates.domain.TemplateRemoteSource
import com.billkit.feature.templates.domain.TemplateRepository
import com.billkit.feature.templates.domain.TemplateStore
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test

@OptIn(ExperimentalCoroutinesApi::class)
class TemplatesViewModelTest {

    // The same dispatcher the test runs on: the screen debounces nothing today,
    // but sharing it is what makes advanceUntilIdle() mean "everything settled".
    private val dispatcher = StandardTestDispatcher()

    @BeforeEach fun setUp() = Dispatchers.setMain(dispatcher)
    @AfterEach fun tearDown() = Dispatchers.resetMain()

    private fun item(id: String) = TemplateCatalogItem(
        id = id, name = "Bill $id", description = null, filename = "b.btpkg",
        byteSize = 3, pageWidth = 794, pageHeight = 1123, fieldCount = 4,
        assetCount = 0, uploadedAt = "2026-10-12T00:00:00.000Z",
    )

    private class FakeRemote(
        var catalog: Result<List<TemplateCatalogItem>, DataError> = Result.Success(emptyList()),
        var download: Result<ByteArray, DataError> = Result.Success(ByteArray(0)),
    ) : TemplateRemoteSource {
        var downloadCalls = 0
        override suspend fun catalog(baseUrl: String) = catalog
        override suspend fun download(baseUrl: String, id: String): Result<ByteArray, DataError> {
            downloadCalls++
            return download
        }
    }

    private class FakeStore : TemplateStore {
        val stored = linkedMapOf<String, ByteArray>()
        override suspend fun list() = stored.map { LocalTemplate(it.key, "Bill ${it.key}", it.value.size.toLong(), "t") }
        override suspend fun save(item: TemplateCatalogItem, bytes: ByteArray) = Result.Success(stored.put(item.id, bytes))
        override suspend fun read(id: String) = Result.Success(stored[id])
        override suspend fun delete(id: String) = Result.Success(stored.remove(id))
    }

    private fun digestOf(bytes: ByteArray) =
        java.security.MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }

    private fun viewModel(remote: FakeRemote = FakeRemote(), store: FakeStore = FakeStore()) =
        TemplatesViewModel(TemplateRepository(remote, store, "http://host"))

    @Test
    fun `refresh lists what the server offers`() = runTest(dispatcher) {
        val vm = viewModel(remote = FakeRemote(catalog = Result.Success(listOf(item("a"), item("b")))))
        vm.onAction(TemplatesAction.Refresh)
        advanceUntilIdle()
        assertThat(vm.state.value.remote).hasSize(2)
        assertThat(vm.state.value.isRefreshing).isFalse()
    }

    @Test
    fun `an unreachable server surfaces an error and stops the spinner`() = runTest(dispatcher) {
        val vm = viewModel(remote = FakeRemote(catalog = Result.Error(DataError.NetworkUnavailable)))
        vm.onAction(TemplatesAction.Refresh)
        advanceUntilIdle()
        assertThat(vm.state.value.error).isEqualTo(DataError.NetworkUnavailable)
        assertThat(vm.state.value.isRefreshing).isFalse()
    }

    @Test
    fun `downloading verifies the digest and only then stores`() = runTest(dispatcher) {
        val bytes = ByteArray(4, 3)
        val id = digestOf(bytes)
        val store = FakeStore()
        val vm = viewModel(remote = FakeRemote(download = Result.Success(bytes)), store = store)

        vm.onAction(TemplatesAction.Download(item(id)))
        advanceUntilIdle()

        assertThat(store.stored.keys).isEqualTo(setOf(id))
        assertThat(vm.state.value.storedIds).contains(id)
        assertThat(vm.state.value.downloading).isEmpty()
    }

    @Test
    fun `a corrupt download is refused and nothing is stored`() = runTest(dispatcher) {
        val store = FakeStore()
        val vm = viewModel(remote = FakeRemote(download = Result.Success(ByteArray(9))), store = store)

        vm.onAction(TemplatesAction.Download(item("a".repeat(64))))
        advanceUntilIdle()

        assertThat(vm.state.value.error).isEqualTo(DataError.DownloadCorrupt)
        assertThat(store.stored).isEmpty()
        assertThat(vm.state.value.downloading).isEmpty()
    }

    @Test
    fun `deleting forgets the package locally`() = runTest(dispatcher) {
        val bytes = ByteArray(4, 3)
        val id = digestOf(bytes)
        val store = FakeStore()
        val vm = viewModel(remote = FakeRemote(download = Result.Success(bytes)), store = store)
        vm.onAction(TemplatesAction.Download(item(id)))
        advanceUntilIdle()

        vm.onAction(TemplatesAction.Delete(id))
        advanceUntilIdle()

        assertThat(store.stored).isEmpty()
        assertThat(vm.state.value.storedIds).isEmpty()
    }

    @Test
    fun `using a template emits exactly one event`() = runTest(dispatcher) {
        val vm = viewModel()
        vm.events.test {
            vm.onAction(TemplatesAction.Use("a".repeat(64)))
            val event = awaitItem()
            assertThat(event).isEqualTo(TemplatesEvent.UseTemplate("a".repeat(64)))
            expectNoEvents()
        }
    }

    @Test
    fun `the initial load runs without an explicit action`() = runTest(dispatcher) {
        val vm = viewModel(remote = FakeRemote(catalog = Result.Success(listOf(item("a")))))
        advanceUntilIdle()
        assertThat(vm.state.value.remote).hasSize(1)
    }
}
```

- [ ] **Step 3: Write the ViewModel**

Create `TemplatesViewModel.kt`:
```kotlin
package com.billkit.feature.templates.presentation

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.billkit.core.domain.DataError
import com.billkit.core.domain.Result
import com.billkit.feature.templates.domain.TemplateCatalogItem
import com.billkit.feature.templates.domain.TemplateRepository
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.receiveAsFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class TemplatesState(
    val remote: List<TemplateCatalogItem> = emptyList(),
    val storedIds: Set<String> = emptySet(),
    val downloading: Set<String> = emptySet(),
    val isRefreshing: Boolean = false,
    val error: DataError? = null,
)

sealed interface TemplatesAction {
    data object Refresh : TemplatesAction
    data class Download(val item: TemplateCatalogItem) : TemplatesAction
    data class Delete(val id: String) : TemplatesAction
    data class Use(val id: String) : TemplatesAction
}

sealed interface TemplatesEvent {
    data class UseTemplate(val id: String) : TemplatesEvent
}

/**
 * Deliberately its own ViewModel, not the activity-scoped renderer one.
 *
 * The renderer's ViewModel owns a WebView and a loaded document; sharing it would
 * make drawing a list start a render pipeline. This one only ever holds
 * identifiers and issues requests.
 */
class TemplatesViewModel(
    private val repository: TemplateRepository,
) : ViewModel() {

    private val _state = MutableStateFlow(TemplatesState())
    val state = _state.asStateFlow()

    private val _events = Channel<TemplatesEvent>()
    val events = _events.receiveAsFlow()

    init {
        onAction(TemplatesAction.Refresh)
        viewModelScope.launch { syncStored() }
    }

    fun onAction(action: TemplatesAction) {
        when (action) {
            TemplatesAction.Refresh -> refresh()
            is TemplatesAction.Download -> download(action.item)
            is TemplatesAction.Delete -> delete(action.id)
            is TemplatesAction.Use -> viewModelScope.launch { _events.send(TemplatesEvent.UseTemplate(action.id)) }
        }
    }

    private fun refresh() {
        viewModelScope.launch {
            _state.update { it.copy(isRefreshing = true, error = null) }
            when (val r = repository.refresh()) {
                is Result.Error -> _state.update { it.copy(isRefreshing = false, error = r.error) }
                is Result.Success -> {
                    _state.update { it.copy(remote = r.value, isRefreshing = false) }
                    syncStored()
                }
            }
        }
    }

    private fun download(item: TemplateCatalogItem) {
        viewModelScope.launch {
            _state.update { it.copy(downloading = it.downloading + item.id, error = null) }
            when (val r = repository.download(item)) {
                is Result.Error -> _state.update {
                    it.copy(downloading = it.downloading - item.id, error = r.error)
                }
                is Result.Success -> {
                    _state.update { it.copy(downloading = it.downloading - item.id) }
                    syncStored()
                }
            }
        }
    }

    private fun delete(id: String) {
        viewModelScope.launch {
            when (val r = repository.forget(id)) {
                is Result.Error -> _state.update { it.copy(error = r.error) }
                is Result.Success -> syncStored()
            }
        }
    }

    private suspend fun syncStored() {
        when (val r = repository.stored()) {
            is Result.Error -> _state.update { it.copy(error = r.error) }
            is Result.Success -> _state.update { it.copy(storedIds = r.value.map { s -> s.id }.toSet()) }
        }
    }
}
```

- [ ] **Step 4: Run the ViewModel test**

```powershell
.\gradlew.bat --no-configuration-cache :feature:templates:presentation:test
```
Expected: 7 passed.

- [ ] **Step 5: Write the screen**

Create `TemplatesScreen.kt` — a `LazyColumn` of cards. Each row: name, page size, field
count, and one button that is **Use** when `id in state.storedIds`, **Download** otherwise,
plus a delete affordance when stored. Wrap in `PullToRefreshBox` (Material3 1.3+, present in
Compose BOM 2026.02.01) bound to `state.isRefreshing`, and a `SnackbarHost` fed by
`state.error?.toUiText()`.

Give the screen test tags following the existing convention:
`TAG_TEMPLATES_LIST = "templates-list"`, `TAG_TEMPLATES_REFRESH = "templates-refresh"`,
`TAG_TEMPLATE_USE = "template-use"`, `TAG_TEMPLATE_DOWNLOAD = "template-download"`.

Follow the existing `Root`/`stateless` split: `TemplatesRoot` collects state and wires
callbacks; `TemplatesScreen(state, onRefresh, onDownload, onUse, onDelete)` is pure.

- [ ] **Step 6: Write the navigation**

Create `TemplatesNavigation.kt`:
```kotlin
package com.billkit.feature.templates.presentation

import androidx.compose.runtime.Composable
import androidx.navigation.NavController
import androidx.navigation.NavGraphBuilder
import androidx.navigation.compose.composable
import kotlinx.serialization.Serializable
import org.koin.androidx.compose.koinViewModel

@Serializable
data object TemplatesGraphRoute

@Serializable
data object TemplatesRoute

fun NavGraphBuilder.templatesGraph(
    navController: NavController,
    onUseTemplate: (String) -> Unit,
) {
    navigation<TemplatesGraphRoute>(startDestination = TemplatesRoute) {
        composable<TemplatesRoute> {
            TemplatesRoot(
                viewModel = koinViewModel(),
                onBack = { navController.popBackStack() },
                onUseTemplate = onUseTemplate,
            )
        }
    }
}
```

`feature:templates` never imports `feature:renderer`: `onUseTemplate` is a callback supplied
by `:app`, which knows about both graphs. `FillRoute` stays where it is.

- [ ] **Step 7: Add strings and the Koin module**

Create `.../presentation/src/main/res/values/strings.xml`:
```xml
<?xml version="1.0" encoding="utf-8"?>
<resources>
    <string name="templates_title">Templates</string>
    <string name="templates_empty">No templates yet. Pull to refresh.</string>
    <string name="templates_offline_hint">Downloaded templates are kept on this device.</string>
    <string name="templates_use">Use</string>
    <string name="templates_download">Download</string>
    <string name="templates_delete">Delete</string>
    <string name="templates_page">%1$d × %2$d</string>
</resources>
```

Create `TemplatesPresentationModule.kt`:
```kotlin
package com.billkit.feature.templates.presentation

import com.billkit.feature.templates.domain.TemplateRepository
import org.koin.androidx.viewmodel.dsl.viewModel
import org.koin.dsl.module

val templatesPresentationModule = module {
    viewModel { TemplatesViewModel(get<TemplateRepository>()) }
}
```

`TemplateRepository` is not registered by any module yet. Add it to `templatesDataModule`:
```kotlin
    single { TemplateRepository(get<TemplateRemoteSource>(), get(), baseUrl) }
```
which needs the server URL. Pass it in from `:app`:
```kotlin
    single { TemplateRepository(get<TemplateRemoteSource>(), get<TemplateStore>(), BuildConfig.SERVER_URL) }
```
placed in the `:app` module's own Koin definition, since `BuildConfig` belongs to `:app`.

- [ ] **Step 8: Wire the app**

In `App.kt`, add `templatesDataModule` and `templatesPresentationModule` to `startKoin`.

In `MainActivity.kt`:
```kotlin
        val renderer = rememberRendererViewModel()
        NavHost(navController = navController, startDestination = RendererGraphRoute) {
            rendererGraph(
                navController = navController,
                onOpenBill = { navController.navigate(HomeRoute) },
                onOpenTemplates = { navController.navigate(TemplatesRoute) },
            )
            templatesGraph(
                navController = navController,
                onUseTemplate = { id ->
                    renderer.onAction(RendererAction.OnOpenStoredTemplate(id))
                    navController.navigate(FillRoute)
                },
            )
        }
```

Add `implementation(project(":feature:templates:data"))` and
`implementation(project(":feature:templates:presentation"))` to `app/build.gradle.kts`.

In `HomeScreen.kt`, add a Templates button that calls an `onOpenTemplates` callback, and
thread that callback through `HomeRoot` and `rendererGraph` as `onOpenTemplates`.

- [ ] **Step 9: Run the whole gate**

```powershell
.\gradlew.bat --no-configuration-cache assembleDebug testDebugUnitTest lintDebug
```
Expected: green, 21 + 7 + 10 = 38 tests.

---

### Task 6: End-to-end proof on the device

No unit test proves three languages agree. This does.

**Files:** none.

- [ ] **Step 1: Seed and start the server**

From `Prototype\server`:
```powershell
$env:BILLKIT_ADMIN_PASSWORD="demo"
npm.cmd run seed
npm.cmd start
```
Expected: the seed logs a package name and a 12-character id prefix.

- [ ] **Step 2: Install and launch**

```powershell
.\gradlew.bat --no-configuration-cache :app:installDebug
adb shell am start -n com.billkit.host/.MainActivity
```

- [ ] **Step 3: Check the network from inside the emulator**

```powershell
adb shell "curl -s -o /dev/null -w '%{http_code}' http://10.0.2.2:4000/api/packages" 2>$null
```
Expected: `200`. A blank result means the emulator cannot route to the host — fall back to
```powershell
adb reverse tcp:4000 tcp:4000
```
and rebuild with `-PbillkitServerUrl=http://127.0.0.1:4000`.

- [ ] **Step 4: Walk the flow**

In the app: Home → **Templates**. Confirm the seeded package is listed with its page size and
field count. Tap **Download**; confirm it moves to the stored state. Tap **Use**; confirm the
Fill screen appears with that template's fields. Fill it, confirm, and confirm **Preview**
renders it. Press **Print** and confirm the page is the downloaded template, not the bundled
sample.

- [ ] **Step 5: Prove the verification is real**

On the server, stop it, then on the device pull to refresh.
Expected: `error_network_unavailable` ("Could not reach the template server"), and the
previously downloaded template must still open — proving stored packages do not depend on the
server being up.

- [ ] **Step 6: Confirm corruption is caught**

Corrupt one stored file on the device:
```powershell
adb shell "run-as com.billkit.host sh -c 'ls files/templates'"
```
then push a truncated archive over it and re-download. Expected: the app refuses it and shows
"did not match what the server promised, so it was discarded".

---

## Self-Review

**Spec coverage.** Ktor wiring and cleartext (Task 1); `DataError` + strings (Task 2); Ktor client and file store (Task 3); the lazy-sample change and `OnOpenStoredTemplate` (Task 4); the Templates screen and route (Task 5); the device proof including the corruption case (Task 6).

**Deviation from the spec, deliberate.** The spec said Home guards the sample load "by a local flag". The plan checks `state.documentName == null` instead, because a flag would still reset a chosen template when the user returns to Home from the preview. The plan's behaviour is a superset of the spec's and is covered by `the sample is no longer opened on construction`.

**Placeholder scan.** No `TBD`, no "add error handling", no "similar to Task N". Task 5 Step 5 describes the screen in prose because it is layout, not logic; the logic it depends on is fully specified in Steps 3 and 6.

**Type consistency.** `TemplateRepository`, `TemplateStore`, `TemplateRemoteSource`, `TemplateCatalogItem`, `LocalTemplate`, `DataError.*`, `TemplatesState`/`TemplatesAction`/`TemplatesEvent`, `OnOpenStoredTemplate`, `rememberRendererViewModel`, `templatesGraph` are each defined once and used by one spelling throughout.

**Known rough edge.** `java.time.Instant` in `FileTemplateStore.save` needs API 26 while `minSdk` is 24; Task 3 Step 7 names the one-line replacement.