import com.android.build.gradle.BaseExtension
import org.jetbrains.kotlin.gradle.dsl.JvmTarget
import org.jetbrains.kotlin.gradle.tasks.KotlinCompile

allprojects {
    repositories {
        google()
        mavenCentral()
    }
}

val newBuildDir: Directory =
    rootProject.layout.buildDirectory
        .dir("../../build")
        .get()
rootProject.layout.buildDirectory.value(newBuildDir)

subprojects {
    val newSubprojectBuildDir: Directory = newBuildDir.dir(project.name)
    project.layout.buildDirectory.value(newSubprojectBuildDir)
}

// Algunos plugins (p. ej. tflite_flutter) traen Java 11 y Kotlin 17, y Gradle los rechaza por incompatibles.
// Aquí se fija Java 17 para TODOS los módulos. Va ANTES de `evaluationDependsOn`, que adelanta la evaluación.
subprojects {
    // `afterEvaluate` corre DESPUÉS de que cada plugin fija lo suyo, así que esto manda.
    // Va antes del `evaluationDependsOn` de abajo; si se pusiera después, Gradle ya habría evaluado los módulos.
    afterEvaluate {
        extensions.findByName("android")?.let { ext ->
            (ext as BaseExtension).compileOptions {
                sourceCompatibility = JavaVersion.VERSION_17
                targetCompatibility = JavaVersion.VERSION_17
            }
        }
        tasks.withType<KotlinCompile>().configureEach {
            compilerOptions.jvmTarget.set(JvmTarget.JVM_17)
        }
    }
}

subprojects {
    project.evaluationDependsOn(":app")
}

tasks.register<Delete>("clean") {
    delete(rootProject.layout.buildDirectory)
}
