// jenkins/seed-job.groovy
// Job DSL seed script — run once via a "Seed Job" in Jenkins to provision
// the multibranch pipeline for this repo. Requires the Job DSL plugin.

multibranchPipelineJob('legal-contract-pipeline') {
    displayName('Legal Contract Pipeline')
    description('AI-powered contract review — backend, frontend, evals, k8s deploy')

    branchSources {
        github {
            id('legal-contract-pipeline-source')
            repoOwner('your-org')
            repository('legal-contract-pipeline')
            credentialsId('github-app-creds')
            traits {
                gitHubBranchDiscovery { strategyId(1) }     // discover branches
                gitHubPullRequestDiscovery { strategyId(2) } // discover PRs (merge build)
                gitHubForkDiscovery {
                    strategyId(2)
                    trust { gitHubTrustPermissions() }
                }
            }
        }
    }

    factory {
        workflowBranchProjectFactory {
            scriptPath('Jenkinsfile')
        }
    }

    orphanedItemStrategy {
        discardOldItems {
            numToKeep(15)
            daysToKeep(60)
        }
    }

    triggers {
        periodicFolderTrigger { interval('5m') }  // rescan for new branches/PRs
    }
}

// Folder-level credentials/config could be wired here as well, e.g.:
// folder('legal-contract-pipeline') {
//     properties {
//         envVars {
//             env('AWS_DEFAULT_REGION', 'us-east-1')
//         }
//     }
// }
