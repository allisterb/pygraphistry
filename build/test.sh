#!/bin/bash -ex

cd $(dirname "$0")/../ > /dev/null

# Relevant Jenkins environment variables:
# BUILD_NUMBER - The current build number, such as "153"
# CHANGE_TARGET - The target or base branch to which the change should be merged

if [ -z $PG_PORT            ]; then export PG_PORT=5432; fi
if [ -z $DB_NAME 			]; then export DB_NAME=graphistry; fi
if [ -z $PG_USER            ]; then export PG_USER=graphistry; fi
if [ -z $PG_PASS            ]; then export PG_PASS=pg-test-password; fi
if [ -z $GRAPHISTRY_NETWORK ]; then export GRAPHISTRY_NETWORK=graphistry-network; fi
if [ -z $PG_CONTAINER       ]; then export PG_CONTAINER=${GRAPHISTRY_NETWORK}-pg; fi
if [ -z $TARGET_REF         ]; then export TARGET_REF=${CHANGE_TARGET:-master}; fi
if [ -z $COMMIT_ID          ]; then export COMMIT_ID=$(git rev-parse --short HEAD); fi
if [ -z $BRANCH_NAME        ]; then export BRANCH_NAME=$(git name-rev --name-only HEAD); fi
if [ -z $BUILD_TAG          ]; then export BUILD_TAG=${BUILD_TAG:-test}-${BUILD_NUMBER:-dev}; fi

PROJECTS=packages
NAMESPACE=graphistry
LERNA_CONTAINER="$NAMESPACE/lerna-docker"
LERNA_LS_CHANGED="lerna exec --loglevel=error --since $TARGET_REF -- echo \${PWD##*/}"

docker network inspect $GRAPHISTRY_NETWORK || docker network create $GRAPHISTRY_NETWORK

docker build -f build/dockerfiles/Dockerfile-lerna \
	--build-arg NAMESPACE=${NAMESPACE} \
	-t ${LERNA_CONTAINER} .

for PROJECT in $(docker run \
	-v "${PWD}":/${NAMESPACE} \
	-e TARGET_REF=${TARGET_REF} \
	--rm ${LERNA_CONTAINER} ${LERNA_LS_CHANGED})
do
	echo "checking $PROJECT for build files"

	PROJECT_BUILD_DIR="./$PROJECTS/$PROJECT/build"

	if [ ! -f "$PROJECT_BUILD_DIR/test.sh" ]; then
		echo "expected $PROJECT_BUILD_DIR/test.sh, but none found"
		exit 1
	fi

	export CONTAINER_NAME="$NAMESPACE/$PROJECT"

	echo "building container: $CONTAINER_NAME"

	sh ${PROJECT_BUILD_DIR}/test.sh
done

docker network rm $GRAPHISTRY_NETWORK

echo "test finished"
