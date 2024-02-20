#!/bin/bash

FILEPATH="/tmp/aws-sam-cli-linux-x86_64.zip"
UNZIPPATH="/tmp/sam-installation"

wget -O $FILEPATH https://github.com/aws/aws-sam-cli/releases/latest/download/aws-sam-cli-linux-x86_64.zip
unzip $FILEPATH -d $UNZIPPATH
sudo $UNZIPPATH/install
