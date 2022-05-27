import axios from 'axios'
import JSZip from 'jszip'
import {chain, find} from 'lodash-es'
import crypto from 'node:crypto'

// pass in site
export async function publishSite({ siteID, host, files, activeDeployment }) {
  let deployment
  let error
  try {
    if (host.name === 'vercel') {
      const { data } = await axios
        .post(
          'https://api.vercel.com/v12/now/deployments',
          {
            name: siteID,
            files,
            projectSettings: {
              framework: null,
            },
            target: 'production',
          },
          {
            headers: {
              Authorization: `Bearer ${host.token}`,
            },
          }
        )
  
      deployment = {
        id: data.projectId,
        url: `https://${data.alias.pop()}`,
        created: data.createdAt,
      }
    } else if (host.name === 'netlify') {
      if (!activeDeployment) {
        const {data} = await uploadFiles({
          endpoint: 'https://api.netlify.com/api/v1/sites',
          files
        })
        if (data) {
          deployment = {
            id: data.id,
            deploy_id: data.deploy_id,
            url: `https://${data.subdomain}.netlify.com`,
            created: Date.now(),
          }
        } 
      } else {
        const {data} = await uploadFiles({
          endpoint: `https://api.netlify.com/api/v1/sites/${activeDeployment.id}/deploys`,
          files
        })
        if (data) {
          deployment = {
            id: data.site_id,
            deploy_id: data.id,
            url: data.ssl_url,
            created: Date.now(),
          }
        }
      }
    }
  } catch(e) {
    error = e.toString()
    console.error(error)
  }
  return { deployment, error }

  async function uploadFiles({ endpoint, files }) {
    let error = 'Could not upload files to Netlify'
    const filesToUpload = chain(files.map(f => {
      var shasum = crypto.createHash('sha1')
      shasum.update(f.data)
      return ({ 
        hash: shasum.digest('hex'), 
        file: `/${f.file}`
      })
    }))
      .keyBy('file')
      .mapValues('hash')
      .value()

    // upload hashes to netlify
    const res = await axios
      .post(
        endpoint,
        {
          "files": filesToUpload
        },
        {
          headers: {
            Authorization: `Bearer ${host.token}`,
          },
        }
      )

    // upload missing files
    if (res.data) {
      const {required, id, deploy_id} = res.data // deploy_id for new site, id for existing site (!?)
      await Promise.all(
        required.map(async (hash) => {
          const fileName = Object.keys(filesToUpload).find(key => filesToUpload[key] === hash)
          const {data} = find(files, ['file', fileName.slice(1)])
          await axios.put(`https://api.netlify.com/api/v1/deploys/${deploy_id || id}/files${fileName}`, 
            data, 
            {
              headers: {
                'Content-Type': 'application/octet-stream',
                Authorization: `Bearer ${host.token}`
              }
          })
        })
      )
      return { data: res.data, error: null }
    } else return { data: null, error }
  }
}